import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';

// Create a Storage instance with explicit credentials
let storage: Storage;
try {
  // Decode the Base64-encoded credentials from the environment variable
  const credentialsJson = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64 || '', 'base64').toString();
  const credentials = JSON.parse(credentialsJson);
  
  storage = new Storage({
    credentials,
    projectId: credentials.project_id
  });
  console.log('Google Cloud Storage initialized successfully for project:', credentials.project_id);
} catch (error) {
  console.error('Error initializing Google Cloud Storage:', error);
}

// Specify the name of your bucket
const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'mol_summit';

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const transcriptNumber = formData.get('transcriptNumber') as string;
    const userId = formData.get('userId') as string;

    if (!file) {
      return NextResponse.json({ message: 'No file provided' }, { status: 400 });
    }

    if (!transcriptNumber) {
      return NextResponse.json({ message: 'No transcript number provided' }, { status: 400 });
    }
    
    if (!userId) {
      return NextResponse.json({ message: 'No user ID provided' }, { status: 400 });
    }

    // Validate userId format
    if (!/^[a-zA-Z0-9_-]+$/.test(userId) || userId.length < 3 || userId.length > 20) {
      return NextResponse.json({ message: 'Invalid User ID format' }, { status: 400 });
    }

    if (!storage) {
      return NextResponse.json({ 
        message: 'Google Cloud Storage not configured. Please set up credentials in settings.' 
      }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create a unique filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    // Handle transcript numbers that may or may not have 't' prefix
    const normalizedTranscriptNumber = transcriptNumber.startsWith('t') ? transcriptNumber : `t${transcriptNumber}`;
    const fileName = `transcript_${normalizedTranscriptNumber}_annotations_${timestamp}.xlsx`;

    console.log('Uploading XLSX file to Google Cloud Storage:', {
      fileName,
      fileSize: buffer.length,
      transcriptNumber,
      userId
    });

    // Upload to Google Cloud Storage with user organization
    const bucket = storage.bucket(bucketName);
    const cloudFileName = `users/${userId}/${fileName}`;
    
    const file_ref = bucket.file(cloudFileName);
    
    await file_ref.save(buffer, {
      metadata: {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          transcriptNumber: transcriptNumber,
          userId: userId,
          uploadedAt: new Date().toISOString(),
          originalFileName: fileName
        }
      }
    });

    // Get the file size for response
    const [metadata] = await file_ref.getMetadata();
    const fileSize = parseInt(String(metadata.size || '0'));

    console.log('Successfully uploaded XLSX file to Google Cloud Storage');

    return NextResponse.json({ 
      message: 'XLSX file uploaded successfully to Google Cloud Storage!',
      fileName: cloudFileName,
      fileSize: Math.round(fileSize / 1024) + ' KB',
      transcriptNumber: transcriptNumber,
      userId: userId,
      uploadedAt: new Date().toISOString(),
      storage: 'cloud'
    });
  } 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catch (error: any) {
    console.error('Error uploading XLSX file to cloud:', error);
    return NextResponse.json({ 
      message: `Error uploading XLSX file to cloud: ${error?.message || 'Unknown error'}` 
    }, { status: 500 });
  }
} 