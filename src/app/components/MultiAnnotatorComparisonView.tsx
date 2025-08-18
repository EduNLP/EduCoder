"use client";

import React, { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';

interface AnnotationCategory {
  codes: string[];
  annotations: Record<number, Record<string, boolean | number | string>>;
  definitions?: Record<string, { Definition: string }>;
}

interface CurrentAnnotatorData {
  [category: string]: AnnotationCategory;
}

interface TableRow {
  col1: string | null;
  col2: number;
  col3: string;
  col4: string;
  col5: string;
  col6: string;
  col7: string;
  noteIds: string;
  [key: string]: string | number | null;
}


interface GroupedCloudFiles {
  [userId: string]: Array<{
    fileName: string;
    uploadedAt: string;
    size: number;
  }>;
}

interface AnnotatorData {
  annotator_id: string;
  display_name: string;
  description: string;
  filename: string;
  upload_date: string;
  notes: string;
  annotations: {
    [lineNumber: number]: {
      [category: string]: {
        [feature: string]: boolean | number | string;
      };
    };
  };
  categories: {
    [category: string]: {
      features: string[];
      definitions?: {
        [feature: string]: string;
      };
    };
  };
  notesData?: {
    notes: Record<string, unknown>[];
    transcript: Record<string, unknown>[];
  };
}

interface IRRStats {
  feature: string;
  category: string;
  agreement: number;
  totalComparisons: number;
  agreements: number;
  disagreements: number;
  cohensKappa: number | null;
  krippendorffsAlpha: number | null;
}

interface MultiAnnotatorComparisonViewProps {
  tableData: TableRow[];
  currentAnnotatorData: CurrentAnnotatorData | null;
  onBack: () => void;
  speakerColors: { [key: string]: string };
  notes?: Array<{
    id: number;
    title: string;
    content_1: string;
    content_2: string;
    rowIndices: number[];
    lineNumbers: number[];
  }>;
  getNoteDisplayText?: (idsString: string, rowIndex: number) => React.ReactNode;
  hasSelectableColumn: boolean;
}

// Helper function to convert annotation values to boolean
const convertToBoolean = (value: string | number | boolean | null): boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase().trim();
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
    if (lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === '') return false;
  }
  return null;
};

// Cohen's Kappa calculation for two annotators
const calculateCohensKappa = (annotator1Values: (string | number | boolean | null)[], annotator2Values: (string | number | boolean | null)[]): number | null => {
  // Convert to boolean values and filter to only include cases where both annotators provided values
  const validPairs: Array<[boolean, boolean]> = [];
  for (let i = 0; i < annotator1Values.length; i++) {
    const val1 = convertToBoolean(annotator1Values[i]);
    const val2 = convertToBoolean(annotator2Values[i]);
    if (val1 !== null && val2 !== null) {
      validPairs.push([val1, val2]);
    }
  }

  if (validPairs.length === 0) {
    return null;
  }

  // Calculate observed agreement
  const agreements = validPairs.filter(([a, b]) => a === b).length;
  const observedAgreement = agreements / validPairs.length;

  // Calculate expected agreement (chance agreement)
  const annotator1True = validPairs.filter(([a]) => a === true).length;
  const annotator1False = validPairs.filter(([a]) => a === false).length;
  const annotator2True = validPairs.filter(([, b]) => b === true).length;
  const annotator2False = validPairs.filter(([, b]) => b === false).length;

  const n = validPairs.length;
  const expectedAgreement = ((annotator1True * annotator2True) + (annotator1False * annotator2False)) / (n * n);

  // Calculate Cohen's Kappa
  if (expectedAgreement === 1) {
    // When expected agreement is 1 (only one category used), kappa is undefined/meaningless
    // Return null (N/A) regardless of observed agreement
    return null;
  }
  const kappa = (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
  
  return Math.round(kappa * 1000) / 1000; // Round to 3 decimal places
};

// Krippendorff's Alpha calculation for multiple annotators
const calculateKrippendorffsAlpha = (annotatorValues: Array<(string | number | boolean | null)[]>): number | null => {
  if (annotatorValues.length < 2) {
    return null;
  }

  // Create pairable values matrix with boolean conversion
  const pairableValues: Array<Array<boolean | null>> = [];
  const numLines = annotatorValues[0].length;

  for (let lineIndex = 0; lineIndex < numLines; lineIndex++) {
    const lineValues = annotatorValues.map(annotator => convertToBoolean(annotator[lineIndex]));
    // Only include lines where at least 2 annotators provided values
    const validValues = lineValues.filter(v => v !== null);
    if (validValues.length >= 2) {
      pairableValues.push(lineValues);
    }
  }

  if (pairableValues.length === 0) {
    return null;
  }

  // Calculate observed disagreement
  let observedDisagreement = 0;
  let pairCount = 0;

  for (const lineValues of pairableValues) {
    const validIndices: number[] = [];
    lineValues.forEach((value, index) => {
      if (value !== null) validIndices.push(index);
    });

    // Generate all pairs for this line
    for (let i = 0; i < validIndices.length; i++) {
      for (let j = i + 1; j < validIndices.length; j++) {
        const value1 = lineValues[validIndices[i]] as boolean;
        const value2 = lineValues[validIndices[j]] as boolean;
        if (value1 !== value2) {
          observedDisagreement++;
        }
        pairCount++;
      }
    }
  }

  if (pairCount === 0) {
    return null;
  }

  // Calculate expected disagreement
  const allValues: boolean[] = [];
  for (const lineValues of pairableValues) {
    for (const value of lineValues) {
      if (value !== null) {
        allValues.push(value);
      }
    }
  }

  const trueCount = allValues.filter(v => v === true).length;
  const falseCount = allValues.filter(v => v === false).length;
  const totalValues = allValues.length;

  if (totalValues < 2) {
    return null;
  }

  // For binary data, expected disagreement is the probability of picking different values
  const expectedDisagreement = (2 * trueCount * falseCount) / (totalValues * (totalValues - 1));

  // Calculate Krippendorff's Alpha
  const observedDisagreementRate = observedDisagreement / pairCount;
  
  if (expectedDisagreement === 0) {
    return null; // No expected disagreement
  }
  
  const alpha = 1 - (observedDisagreementRate / expectedDisagreement);
  
  return Math.round(alpha * 10000) / 10000; // Round to 4 decimal places for better precision
};

export default function MultiAnnotatorComparisonView({
  tableData,
  currentAnnotatorData: rawCurrentAnnotatorData,
  onBack,
  speakerColors,
  notes = [],
  getNoteDisplayText,
  hasSelectableColumn
}: MultiAnnotatorComparisonViewProps) {
  
  // Fix currentAnnotatorData if it's an array instead of object
  const currentAnnotatorData = React.useMemo(() => {
    if (!rawCurrentAnnotatorData) return null;
    
    // If it's already an object with string keys, use it as-is
    if (typeof rawCurrentAnnotatorData === 'object' && !Array.isArray(rawCurrentAnnotatorData)) {
      return rawCurrentAnnotatorData;
    }
    
    // If it's an array, log error and return null
    if (Array.isArray(rawCurrentAnnotatorData)) {
      console.error('currentAnnotatorData is an array, expected object:', rawCurrentAnnotatorData);
      return null;
    }
    
    return rawCurrentAnnotatorData;
  }, [rawCurrentAnnotatorData]);
  const [otherAnnotators, setOtherAnnotators] = useState<AnnotatorData[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [pullingFromCloud, setPullingFromCloud] = useState(false);
  const [groupedFiles, setGroupedFiles] = useState<GroupedCloudFiles>({});
  const [showAnnotatorSelection, setShowAnnotatorSelection] = useState(false);
  const [selectedTranscripts, setSelectedTranscripts] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const [showUploadSection, setShowUploadSection] = useState(true);
  const [showStatistics, setShowStatistics] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<TableRow[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [showOnlyAnnotated, setShowOnlyAnnotated] = useState(true);
  
  // Expert naming modal state
  const [showNamingModal, setShowNamingModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingAnnotatorData, setPendingAnnotatorData] = useState<AnnotatorData | null>(null);
  const [editingAnnotator, setEditingAnnotator] = useState<AnnotatorData | null>(null);
  const [expertName, setExpertName] = useState('');
  const [expertDescription, setExpertDescription] = useState('');
  const [expertNotes, setExpertNotes] = useState('');
  
  // Notes integration state
  const [showNotesInTable, setShowNotesInTable] = useState(false);
  
  // Notes popup state
  const [selectedNotesLine, setSelectedNotesLine] = useState<{
    lineNumber: number;
    speaker: string;
    utterance: string;
  } | null>(null);

  // Get current transcript number for localStorage key
  const getTranscriptNumber = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const match = path.match(/\/transcript\/(\d+)/);
      return match ? match[1] : 'unknown';
    }
    return 'unknown';
  };

  // Load annotator data from localStorage on component mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const transcriptNumber = getTranscriptNumber();
      const storageKey = `annotator-data-${transcriptNumber}`;
      const savedData = localStorage.getItem(storageKey);
      
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData);
          if (Array.isArray(parsedData) && parsedData.length > 0) {
            setOtherAnnotators(parsedData);
            setShowUploadSection(false); // Hide upload section if data exists
          }
        } catch (error) {
          console.error('Error loading saved annotator data:', error);
          localStorage.removeItem(storageKey); // Clean up corrupted data
        }
      }
    }
  }, []);

  // Save annotator data to localStorage whenever it changes
  React.useEffect(() => {
    if (typeof window !== 'undefined' && otherAnnotators.length > 0) {
      const transcriptNumber = getTranscriptNumber();
      const storageKey = `annotator-data-${transcriptNumber}`;
      localStorage.setItem(storageKey, JSON.stringify(otherAnnotators));
    }
  }, [otherAnnotators]);

  const parseXlsxFile = (file: File): Promise<AnnotatorData | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Use filename (without extension) as annotator ID, with timestamp to ensure uniqueness
          const baseId = file.name.replace(/\.[^/.]+$/, "");
          const annotatorId = `${baseId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Try to extract a meaningful display name from the filename
          // Handle various filename patterns to extract username
          const extractDisplayName = (filename: string): string => {
            // Remove file extension
            const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
            
            // Pattern 1: username_transcript_t01_annotations_timestamp
            const userPrefixMatch = nameWithoutExt.match(/^([a-zA-Z0-9_-]+)_transcript_t\d+_annotations_/);
            if (userPrefixMatch) {
              return userPrefixMatch[1]; // Extract username from prefix
            }
            
            // Pattern 2: transcript_t01_annotations_username_timestamp
            const userMiddleMatch = nameWithoutExt.match(/^transcript_t\d+_annotations_([a-zA-Z0-9_-]+)_\d{4}-\d{2}-\d{2}/);
            if (userMiddleMatch) {
              return userMiddleMatch[1]; // Extract username from middle
            }
            
            // Pattern 3: transcript_t01_annotations_timestamp_username
            const userSuffixMatch = nameWithoutExt.match(/^transcript_t\d+_annotations_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_([a-zA-Z0-9_-]+)$/);
            if (userSuffixMatch) {
              return userSuffixMatch[1]; // Extract username from suffix
            }
            
            // Pattern 4: Standard pattern without username - prompt for manual entry
            if (nameWithoutExt.match(/^transcript_t\d+_annotations_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/)) {
              return "Annotator"; // Generic name that user should customize
            }
            
            // Pattern 5: If filename has underscores, try to get a meaningful part
            const parts = nameWithoutExt.split('_');
            if (parts.length > 1) {
              // Skip common technical parts
              const filtered = parts.filter(part => 
                !part.match(/^(transcript|annotations|t\d+|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2})$/)
              );
              if (filtered.length > 0) {
                return filtered[0]; // Return first meaningful part
              }
            }
            
            // Fallback: Use full filename but encourage manual naming
            return nameWithoutExt;
          };
          
          const displayName = extractDisplayName(file.name);
          
          const annotatorData: AnnotatorData = {
            annotator_id: annotatorId,
            display_name: displayName,
            description: '',
            filename: baseId, // Use base filename without extension for display
            upload_date: new Date().toISOString(),
            notes: '',
            annotations: {},
            categories: {}
          };

          // First, check for Notes sheet and parse it
          const notesSheetName = workbook.SheetNames.find(name => name.toLowerCase() === 'notes');
          if (notesSheetName) {
            const notesWorksheet = workbook.Sheets[notesSheetName];
            const notesJsonData = XLSX.utils.sheet_to_json(notesWorksheet, { defval: null, raw: false });
            
            // Parse notes data similar to UnifiedComparisonView
            annotatorData.notesData = {
              notes: notesJsonData as Record<string, unknown>[],
              transcript: [] // Notes sheet contains the transcript data with notes
            };
          }

          // Check if this is a single-sheet format (all categories in one sheet) or multi-sheet format
          const hasMultipleNonNotesSheets = workbook.SheetNames.filter(name => name.toLowerCase() !== 'notes').length > 1;
          
          if (hasMultipleNonNotesSheets) {
            // Multi-sheet format: Process each sheet as a category (matching current UI export format)
            workbook.SheetNames.forEach(sheetName => {
              // Skip Notes sheet as it's handled separately
              if (sheetName.toLowerCase() === 'notes') return;
              
              const worksheet = workbook.Sheets[sheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
            
            if (jsonData.length < 2) return; // Skip if no data
            
            const headers = jsonData[0] as string[];
            
            // Find the standard columns (matching current UI export format)
            const lineNumIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('line'));
            const speakerIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('speaker'));
            const utteranceIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('utterance'));
            
            if (lineNumIndex === -1) return; // Skip if no line number column
            
            // All other columns are potential feature columns (starting after the basic columns)
            const potentialFeatures: { name: string; index: number }[] = [];
            
            headers.forEach((header, index) => {
              if (header && 
                  index !== lineNumIndex && 
                  index !== speakerIndex && 
                  index !== utteranceIndex) {
                potentialFeatures.push({ name: header.toString(), index });
              }
            });
            
            if (potentialFeatures.length === 0) return; // Skip if no feature columns
            
            // First pass: determine which features actually have data
            const featuresWithData = new Set<string>();
            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || row.length === 0) continue;
              
              potentialFeatures.forEach(({ name, index }) => {
                const value = row[index];
                if (value !== null && value !== undefined && value !== '') {
                  featuresWithData.add(name);
                }
              });
            }
            
            // Only include features that actually have data
            const featureColumns: string[] = [];
            const featureIndices: number[] = [];
            
            potentialFeatures.forEach(({ name, index }) => {
              if (featuresWithData.has(name)) {
                featureColumns.push(name);
                featureIndices.push(index);
              }
            });
            
            if (featureColumns.length === 0) return; // Skip if no features with actual data
            
            // Initialize category
            annotatorData.categories[sheetName] = {
              features: featureColumns,
              definitions: {}
            };
            
            // Process data rows
            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || row.length === 0) continue;
              
              const lineNum = parseInt(String(row[lineNumIndex] || '0'));
              if (isNaN(lineNum) || lineNum === 0) continue;
              
              // Initialize line annotations
              if (!annotatorData.annotations[lineNum]) {
                annotatorData.annotations[lineNum] = {};
              }
              if (!annotatorData.annotations[lineNum][sheetName]) {
                annotatorData.annotations[lineNum][sheetName] = {};
              }
              
              // Process feature values - preserve original values and only store non-empty ones
              featureIndices.forEach((colIndex, featureIndex) => {
                const featureName = featureColumns[featureIndex];
                const rawValue = row[colIndex];
                
                // Check if value represents empty/null (including "None" strings)
                const isEmptyValue = rawValue === null || 
                                   rawValue === undefined || 
                                   rawValue === '' ||
                                   (typeof rawValue === 'string' && 
                                    (rawValue.toLowerCase() === 'none' || 
                                     rawValue.toLowerCase() === 'null' ||
                                     rawValue.trim() === ''));
                

                
                // Only store values that are actually present (not empty/null/None)
                if (!isEmptyValue) {
                  let processedValue: boolean | number | string;
                  
                  // Convert based on actual value type
                  if (rawValue === 1 || rawValue === '1' || String(rawValue).toLowerCase() === 'true' || String(rawValue).toLowerCase() === 'yes') {
                    processedValue = true;
                  } else if (rawValue === 0 || rawValue === '0' || String(rawValue).toLowerCase() === 'false' || String(rawValue).toLowerCase() === 'no') {
                    processedValue = false;
                  } else if (typeof rawValue === 'number') {
                    processedValue = rawValue;
                  } else {
                    // Keep as string for other values
                    processedValue = String(rawValue);
                  }
                  

                  
                  annotatorData.annotations[lineNum][sheetName][featureName] = processedValue;
                }
                // If rawValue is empty/null/None, we don't store anything (undefined means no annotation)
              });
            }
          });
          } else {
            // Single-sheet format: All categories/features in one sheet
            const mainSheet = workbook.SheetNames.find(name => name.toLowerCase() !== 'notes');
            if (mainSheet) {
              const worksheet = workbook.Sheets[mainSheet];
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
              
              if (jsonData.length >= 2) {
                const headers = jsonData[0] as string[];
                
                // Find the standard columns
                const lineNumIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('line'));
                const speakerIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('speaker'));
                const utteranceIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('utterance'));
                
                if (lineNumIndex !== -1) {
                  // All other columns are feature columns
                  const featureColumns: { name: string; index: number }[] = [];
                  headers.forEach((header, index) => {
                    if (header && 
                        index !== lineNumIndex && 
                        index !== speakerIndex && 
                        index !== utteranceIndex) {
                      featureColumns.push({ name: header.toString(), index });
                    }
                  });
                  
                  // Since we have all features in one sheet, we need to group them into a single category
                  // or use the sheet name as the category
                  const categoryName = mainSheet === 'Sheet1' ? 'Main' : mainSheet;
                  
                  // Process each row
                  for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0) continue;
                    
                    const lineNum = parseInt(row[lineNumIndex]?.toString() || '0', 10);
                    if (!lineNum) continue;
                    
                    // Initialize line annotation structure
                    if (!annotatorData.annotations[lineNum]) {
                      annotatorData.annotations[lineNum] = {};
                    }
                    if (!annotatorData.annotations[lineNum][categoryName]) {
                      annotatorData.annotations[lineNum][categoryName] = {};
                    }
                    
                    // Process each feature
                    featureColumns.forEach(({ name, index }) => {
                      const rawValue = row[index];
                      if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
                        // Convert the value to proper type
                        let processedValue: boolean | number | string;
                        if (rawValue === 1 || rawValue === '1' || rawValue === true || rawValue === 'true') {
                          processedValue = true;
                        } else if (rawValue === 0 || rawValue === '0' || rawValue === false || rawValue === 'false') {
                          processedValue = false;
                        } else if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
                          processedValue = rawValue;
                        } else {
                          processedValue = String(rawValue);
                        }
                        
                        annotatorData.annotations[lineNum][categoryName][name] = processedValue;
                      }
                    });
                  }
                  
                  // Set up the categories structure
                  annotatorData.categories[categoryName] = {
                    features: featureColumns.map(f => f.name),
                    definitions: undefined
                  };
                }
              }
            }
          }
          
          resolve(annotatorData);
        } catch (error) {
          console.error('Error parsing XLSX file:', error);
          resolve(null);
        }
      };
      
      reader.onerror = () => {
        console.error('Error reading file');
        resolve(null);
      };
      
      reader.readAsArrayBuffer(file);
    });
  };

  const validateFeaturesAgainstCodebook = useCallback((annotatorData: AnnotatorData): { isValid: boolean; warnings: string[] } => {
    const warnings: string[] = [];
    let isValid = true;

    // Check if categories and features exist in current annotation data
    Object.keys(annotatorData.categories).forEach(category => {
      if (!currentAnnotatorData || !currentAnnotatorData[category]) {
        warnings.push(`Category "${category}" not found in feature definition codebook`);
        isValid = false;
        return;
      }

      const currentCodes = currentAnnotatorData[category].codes || [];
      annotatorData.categories[category].features.forEach(feature => {
        if (!currentCodes.includes(feature)) {
          warnings.push(`Feature "${feature}" in category "${category}" not found in codebook`);
        }
      });
    });

    return { isValid, warnings };
  }, [currentAnnotatorData]);

  const handleExpertNaming = (annotatorData: AnnotatorData) => {
    setPendingAnnotatorData(annotatorData);
    // If display name is generic (like "Annotator"), clear it so user starts fresh
    // Otherwise, keep the extracted name as a starting point
    const initialName = annotatorData.display_name === 'Annotator' ? '' : annotatorData.display_name;
    setExpertName(initialName);
    setExpertDescription('');
    setShowNamingModal(true);
  };

  const saveExpertInfo = () => {
    if (pendingAnnotatorData) {
      if (!expertName.trim()) {
        alert('Please enter a name for this annotator');
        return;
      }
      
      const updatedAnnotator = {
        ...pendingAnnotatorData,
        display_name: expertName.trim(),
        description: expertDescription.trim(),
        notes: expertNotes.trim()
      };
      
      setOtherAnnotators(prev => [...prev, updatedAnnotator]);
      setShowNamingModal(false);
      setPendingAnnotatorData(null);
      setExpertName('');
      setExpertDescription('');
      setExpertNotes('');
    }
  };

  const handleEditExpert = (annotator: AnnotatorData) => {
    setEditingAnnotator(annotator);
    setExpertName(annotator.display_name);
    setExpertDescription(annotator.description);
    setExpertNotes(annotator.notes);
    setShowEditModal(true);
  };

  const saveEditedExpert = () => {
    if (editingAnnotator && expertName.trim()) {
      const updatedAnnotator = {
        ...editingAnnotator,
        display_name: expertName.trim(),
        description: expertDescription.trim(),
        notes: expertNotes.trim()
      };
      
      setOtherAnnotators(prev => 
        prev.map(annotator => 
          annotator.annotator_id === editingAnnotator.annotator_id 
            ? updatedAnnotator 
            : annotator
        )
      );
      setShowEditModal(false);
      setEditingAnnotator(null);
      setExpertName('');
      setExpertDescription('');
      setExpertNotes('');
    }
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setUploading(true);
    setUploadStatus({ type: null, message: '' });
    
    try {
      const newAnnotators: AnnotatorData[] = [];
      const allWarnings: string[] = [];
      
      for (const file of Array.from(files)) {
        // Only process XLSX files
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
          throw new Error(`File ${file.name} is not an XLSX file. Please upload only .xlsx files.`);
        }
        
        const annotatorData = await parseXlsxFile(file);
        
        if (annotatorData) {
          // Check for duplicate annotator IDs
          const existingIds = [...otherAnnotators, ...newAnnotators].map(a => a.annotator_id);
          if (existingIds.includes(annotatorData.annotator_id)) {
            throw new Error(`Duplicate annotator ID: ${annotatorData.annotator_id}`);
          }
          
          // Validate against codebook
          const validation = validateFeaturesAgainstCodebook(annotatorData);
          if (validation.warnings.length > 0) {
            allWarnings.push(`${file.name}: ${validation.warnings.join(', ')}`);
          }
          
          // Show naming modal for each annotator
          handleExpertNaming(annotatorData);
          return; // Process one at a time
        } else {
          throw new Error(`Failed to parse ${file.name}. Please check the file format.`);
        }
      }
      
    } catch (error) {
      setUploadStatus({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Failed to upload files' 
      });
    } finally {
      setUploading(false);
      // Clear the file input
      event.target.value = '';
    }
  }, [otherAnnotators, validateFeaturesAgainstCodebook]);

  const handleShowAvailableAnnotators = useCallback(async () => {
    setPullingFromCloud(true);
    try {
      const transcriptNumber = getTranscriptNumber();
      
      // Call API to get available annotators from cloud storage
      const response = await fetch(`/api/pull-from-cloud?transcriptId=t${transcriptNumber}`);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch available annotators');
      }
      
      if (result.groupedFiles && Object.keys(result.groupedFiles).length > 0) {
        setGroupedFiles(result.groupedFiles);
        setShowAnnotatorSelection(true);
      } else {
        // Show popup instead of small text
        alert(`No annotations found in cloud storage for this transcript.\n\nThis could mean:\n• No one has uploaded annotations for transcript ${transcriptNumber} yet\n• Files may not have the correct naming format\n• There might be an issue with cloud storage connectivity`);
      }
    } catch (error) {
      console.error('Error fetching available annotators:', error);
      setUploadStatus({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Failed to fetch available annotators' 
      });
    } finally {
      setPullingFromCloud(false);
    }
  }, []);


  const handlePullSelectedTranscripts = useCallback(async () => {
    if (selectedTranscripts.size === 0) {
      setUploadStatus({ type: 'error', message: 'Please select at least one transcript to pull.' });
      return;
    }

    setPullingFromCloud(true);
    try {
      const transcriptNumber = getTranscriptNumber();
      
      // Create a map of userId to selected files
      const selectedFilesMap: Record<string, string[]> = {};
      selectedTranscripts.forEach(transcriptKey => {
        const [userId, ...fileParts] = transcriptKey.split('_');
        const fileName = fileParts.join('_');
        if (!selectedFilesMap[userId]) {
          selectedFilesMap[userId] = [];
        }
        selectedFilesMap[userId].push(fileName);
      });

      // Fetch each selected transcript individually
      const newAnnotators: AnnotatorData[] = [];
      
      for (const [userId, fileNames] of Object.entries(selectedFilesMap)) {
        for (const fileName of fileNames) {
          try {
            const response = await fetch('/api/pull-from-cloud', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                transcriptId: `t${transcriptNumber}`,
                userId: userId
              }),
            });
            
            const result = await response.json();
            
            if (!response.ok) {
              console.error(`Failed to fetch transcript for user ${userId}:`, result.error);
              continue;
            }

            // Parse the Excel file content
            const workbook = XLSX.read(result.content, { type: 'array' });
            const sheetNames = workbook.SheetNames;
            
            const categories: Record<string, AnnotationCategory> = {};
            
            // Check if this is a single-sheet format or multi-sheet format
            const nonNotesSheets = sheetNames.filter(name => name.toLowerCase() !== 'notes');
            const hasMultipleNonNotesSheets = nonNotesSheets.length > 1;
            
            if (hasMultipleNonNotesSheets || nonNotesSheets.length === 1) {
              // Multi-sheet format - each sheet represents a category
              for (const sheetName of sheetNames) {
                if (sheetName.toLowerCase() === 'notes') continue;
                
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as (string | number | boolean)[][];
                
                if (data.length < 2) continue;
                
                const headers = data[0] as string[];
                const rows = data.slice(1);
                
                const featureColumns = headers.slice(3);
                const annotations: Record<number, Record<string, boolean | number | string>> = {};
                
                for (const row of rows) {
                  let lineNumber = 0;
                  if (row[0] && !isNaN(parseInt(row[0].toString()))) {
                    lineNumber = parseInt(row[0].toString());
                  }
                  
                  if (!lineNumber) continue;
                  
                  const tableRow = tableData?.find(tr => tr.col2 === lineNumber || parseInt(tr.col2?.toString()) === lineNumber);
                  if (tableRow && hasSelectableColumn) {
                    if (tableRow.col7 && tableRow.col7.trim() !== '') {
                      const selectableValue = tableRow.col7.toLowerCase().trim();
                      const isSelectable = selectableValue === "true" || selectableValue === "yes" || selectableValue === "1";
                      if (!isSelectable) continue;
                    } else {
                      continue;
                    }
                  }
                  
                  const rowAnnotations: Record<string, boolean | number | string> = {};
                  
                  for (let i = 0; i < featureColumns.length; i++) {
                    const feature = featureColumns[i];
                    const value = row[3 + i];
                    
                    if (value !== undefined && value !== null && value !== '') {
                      if (value === 1 || value === '1' || value === true || value === 'true') {
                        rowAnnotations[feature] = true;
                      } else if (value === 0 || value === '0' || value === false || value === 'false') {
                        rowAnnotations[feature] = false;
                      } else {
                        rowAnnotations[feature] = value;
                      }
                    }
                  }
                  
                  if (Object.keys(rowAnnotations).length > 0) {
                    annotations[lineNumber] = rowAnnotations;
                  }
                }
                
                categories[sheetName] = {
                  codes: featureColumns,
                  annotations
                };
              }
            }
            
            const formattedCategories: { [category: string]: { features: string[]; definitions?: { [feature: string]: string } } } = {};
            Object.keys(categories).forEach(categoryName => {
              const category = categories[categoryName];
              formattedCategories[categoryName] = {
                features: category.codes,
                definitions: undefined
              };
            });
            
            const restructuredAnnotations: {
              [lineNumber: number]: {
                [category: string]: {
                  [feature: string]: boolean | number | string;
                };
              };
            } = {};
            
            Object.entries(categories).forEach(([categoryName, categoryData]) => {
              Object.entries(categoryData.annotations).forEach(([lineNumberStr, lineAnnotations]) => {
                const lineNumber = parseInt(lineNumberStr, 10);
                if (!restructuredAnnotations[lineNumber]) {
                  restructuredAnnotations[lineNumber] = {};
                }
                restructuredAnnotations[lineNumber][categoryName] = lineAnnotations as Record<string, boolean | number | string>;
              });
            });

            const annotatorData: AnnotatorData = {
              annotator_id: `${userId}_${fileName}`,
              display_name: userId,
              description: `Pulled from cloud storage`,
              filename: fileName,
              upload_date: new Date().toISOString(),
              notes: '',
              annotations: restructuredAnnotations,
              categories: formattedCategories
            };
            
            newAnnotators.push(annotatorData);
          } catch (error) {
            console.error(`Error processing transcript ${fileName} for user ${userId}:`, error);
          }
        }
      }

      if (newAnnotators.length > 0) {
        setOtherAnnotators(prev => {
          const combined = [...prev, ...newAnnotators];
          
          // Save to localStorage
          const transcriptNumber = getTranscriptNumber();
          const storageKey = `annotator-data-${transcriptNumber}`;
          localStorage.setItem(storageKey, JSON.stringify(combined));
          
          return combined;
        });
        
        setUploadStatus({
          type: 'success',
          message: `Successfully imported ${newAnnotators.length} transcript(s)`
        });
        
        setShowAnnotatorSelection(false);
        setSelectedTranscripts(new Set());
        setExpandedUsers(new Set());
      } else {
        setUploadStatus({
          type: 'error',
          message: 'No transcripts could be imported. Please check the file format.'
        });
      }
    } catch (error) {
      console.error('Error pulling transcripts:', error);
      setUploadStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to pull transcripts'
      });
    } finally {
      setPullingFromCloud(false);
    }
  }, [selectedTranscripts, tableData, hasSelectableColumn]);

  const removeAnnotator = (annotatorId: string) => {
    setOtherAnnotators(prev => {
      const updated = prev.filter(a => a.annotator_id !== annotatorId);
      
      // If no annotators left, clear localStorage and show upload section
      if (updated.length === 0) {
        const transcriptNumber = getTranscriptNumber();
        const storageKey = `annotator-data-${transcriptNumber}`;
        localStorage.removeItem(storageKey);
        setShowUploadSection(true);
      }
      
      return updated;
    });
  };

  const getAllCategories = (): string[] => {
    const categories = new Set<string>();
    
    // Add categories from current annotator data
    if (currentAnnotatorData) {
      Object.keys(currentAnnotatorData).forEach(cat => categories.add(cat));
    }
    
    // Add categories from other annotators
    otherAnnotators.forEach(annotator => {
      Object.keys(annotator.categories).forEach(cat => categories.add(cat));
    });
    
    const allCategories = Array.from(categories).sort();
    
    return allCategories;
  };

  const getFeaturesForCategory = useCallback((category: string): string[] => {
    const features = new Set<string>();
    
    // Add features from current annotator data (codebook)
    if (currentAnnotatorData && currentAnnotatorData[category]) {
      currentAnnotatorData[category].codes.forEach(code => features.add(code));
    }
    
    // Add features from other annotators (uploaded files)
    otherAnnotators.forEach(annotator => {
      if (annotator.categories[category]) {
        annotator.categories[category].features.forEach(feature => features.add(feature));
      }
    });
    
    // IMPORTANT: Also check for features that exist in the annotation data but not in the categories definition
    // This handles cases where uploaded files have features that don't match the codebook
    otherAnnotators.forEach(annotator => {
      Object.keys(annotator.annotations).forEach(lineNum => {
        const lineAnnotations = annotator.annotations[parseInt(lineNum)];
        if (lineAnnotations && lineAnnotations[category]) {
          Object.keys(lineAnnotations[category]).forEach(feature => {
            features.add(feature);
          });
        }
      });
    });
    
    const featuresArray = Array.from(features).sort();
    
    return featuresArray;
  }, [currentAnnotatorData, otherAnnotators]);

  const getCurrentAnnotatorValue = useCallback((lineNumber: number, category: string, feature: string): boolean | number | string | null => {
    if (!currentAnnotatorData || !currentAnnotatorData[category]) {
      // Return null instead of throwing error - this indicates the current user hasn't annotated this category
      // This is expected when uploaded files have categories/features not in the current codebook
      return null;
    }
    
    // For current annotator, use the row index approach (existing logic)
    // Find the row index in the tableData array (this is how current user data is indexed)
    // Handle both string and number comparisons
    const rowIndex = tableData.findIndex(row => 
      row.col2 === lineNumber || parseInt(row.col2?.toString()) === lineNumber
    );
    if (rowIndex === -1) {
      return null;
    }
    
    const annotations = currentAnnotatorData[category].annotations[rowIndex];
    
    if (!annotations) {
      return false;
    }
    
    const value = annotations[feature];
    
    // Return the actual value, or false if undefined (false will show as "No")
    return value ?? false;
  }, [currentAnnotatorData, tableData]);

  const isTableRowSelectable = useCallback((rowData: TableRow): boolean => {
    // If no "Selectable" column exists in the data, all rows are annotatable
    if (!hasSelectableColumn) {
      return true;
    }
    
    // If "Selectable" column exists, check the value
    if (!rowData.col7 || rowData.col7.trim() === '') {
      return false; // Empty values in selectable column mean not selectable
    }
    
    const selectableValue = rowData.col7.toLowerCase().trim();
    return selectableValue === "true" || selectableValue === "yes" || selectableValue === "1";
  }, [hasSelectableColumn]);

  const getAnnotatorValue = useCallback((annotator: AnnotatorData, lineNumber: number, category: string, feature: string): boolean | number | string | null => {
    // For uploaded annotators, get annotation data directly by line number
    // Don't require the line to exist in current tableData since uploaded files may have different line numbers
    const lineAnnotations = annotator.annotations[lineNumber];
    
    if (!lineAnnotations || !lineAnnotations[category]) {
      return null;
    }
    
    const value = lineAnnotations[category][feature] ?? null;
    return value;
  }, []);

  const getDisplayTableData = () => {
    let filteredData = tableData;
    
    // Apply search filter - search both line# and utterance simultaneously
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      filteredData = filteredData.filter(row => {
        const lineMatch = row.col2.toString().includes(term);
        const utteranceMatch = row.col6.toLowerCase().includes(term);
        return lineMatch || utteranceMatch;
      });
    }
    
    // Filter for only annotated rows if requested
    if (showOnlyAnnotated && selectedCategory) {
      filteredData = filteredData.filter(row => {
        // Exclude non-selectable rows since they show "-" for all values (not truly annotated)
        if (!isTableRowSelectable(row)) return false;
        
        const features = getFeaturesForCategory(selectedCategory);
        const shouldInclude = features.some(feature => {
          // Check if current annotator has actual annotation values (not null/undefined/"-")
          const currentValue = getCurrentAnnotatorValue(row.col2, selectedCategory, feature);
          const hasCurrentAnnotation = currentValue !== null && currentValue !== undefined && currentValue !== '-';
          
          // Check if any other annotator has actual annotation values (not null/undefined/"-")
          const hasOtherAnnotations = otherAnnotators.some(annotator => {
            const value = getAnnotatorValue(annotator, row.col2, selectedCategory, feature);
            return value !== null && value !== undefined && value !== '-';
          });
          
          return hasCurrentAnnotation || hasOtherAnnotations;
        });
        
        return shouldInclude;
      });
    }
    
    // Only apply differences filter if category is selected
    if (showOnlyDifferences && selectedCategory) {
      filteredData = filteredData.filter(row => {
        // Exclude non-selectable rows since they all show "-" (no real differences)
        if (!isTableRowSelectable(row)) return false;
        
        const features = getFeaturesForCategory(selectedCategory);
        return features.some(feature => {
          const currentValue = getCurrentAnnotatorValue(row.col2, selectedCategory, feature);
          const otherValues = otherAnnotators.map(annotator => 
            getAnnotatorValue(annotator, row.col2, selectedCategory, feature)
          );
          
          // Only consider actual annotation values (exclude null, undefined, and "-")
          const allValues = [currentValue, ...otherValues].filter(v => v !== null && v !== undefined && v !== '-');
          
          // Only show differences if there are at least 2 actual values and they differ
          return allValues.length >= 2 && !allValues.every(v => v === allValues[0]);
        });
      });
    }

    // Filter for only rows with notes if notes are being shown in table
    if (showNotesInTable) {
      filteredData = filteredData.filter(row => {
        return lineHasNotes(row.col2);
      });
    }
    
    
    return filteredData;
  };

  // Search navigation functions
  const navigateSearch = (direction: 'next' | 'prev') => {
    if (!searchTerm.trim()) return;
    
    const term = searchTerm.toLowerCase().trim();
    const searchableRows = tableData.filter(row => {
      const lineMatch = row.col2.toString().includes(term);
      const utteranceMatch = row.col6.toLowerCase().includes(term);
      return lineMatch || utteranceMatch;
    });
    
    if (searchableRows.length === 0) {
      setCurrentSearchIndex(-1);
      return;
    }
    
    let newIndex;
    if (direction === 'next') {
      newIndex = (currentSearchIndex + 1) % searchableRows.length;
    } else {
      newIndex = (currentSearchIndex - 1 + searchableRows.length) % searchableRows.length;
    }
    
    setCurrentSearchIndex(newIndex);
    
    // Scroll to the current result
    const currentRow = searchableRows[newIndex];
    if (currentRow) {
      const rowElement = document.querySelector(`[data-line="${currentRow.col2}"]`);
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  // Update search results when search term changes
  React.useEffect(() => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const results = tableData.filter(row => {
        const lineMatch = row.col2.toString().includes(term);
        const utteranceMatch = row.col6.toLowerCase().includes(term);
        return lineMatch || utteranceMatch;
      });
      setSearchResults(results);
      if (results.length > 0) {
        setCurrentSearchIndex(0);
      } else {
        setCurrentSearchIndex(-1);
      }
    } else {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
    }
  }, [searchTerm, tableData]);

  // Helper function to get current user's notes for a specific line
  const getCurrentUserNotesForLine = (lineNumber: number): React.ReactNode => {
    if (!getNoteDisplayText) return "—";
    
    // Find the table row for this line number
    const row = tableData.find(r => r.col2 === lineNumber);
    if (!row || !row.noteIds || row.noteIds.trim() === '') return "—";
    
    return getNoteDisplayText(row.noteIds, lineNumber - 1);
  };

  // Check if current user has any notes
  const currentUserHasNotes = notes && notes.length > 0;

  // Check if any annotator has notes data
  const hasNotesData = useMemo(() => {
    return otherAnnotators.some(annotator => annotator.notesData && annotator.notesData.notes.length > 0);
  }, [otherAnnotators]);

  // Helper function to check if a line has notes (either current user or imported annotators)
  const lineHasNotes = (lineNumber: number): boolean => {
    // Check current user notes
    if (currentUserHasNotes) {
      const row = tableData.find(r => r.col2 === lineNumber);
      if (row && row.noteIds && row.noteIds.trim() !== '') {
        const hasUserNotes = notes.some(note => note.lineNumbers.includes(lineNumber));
        if (hasUserNotes) return true;
      }
    }

    // Check imported annotators' notes
    return otherAnnotators.some(annotator => {
      if (!annotator.notesData) return false;

      const noteColumns = Object.keys(annotator.notesData.notes?.[0] || {}).filter(col => {
        const lowerCol = col.toLowerCase();
        return lowerCol !== 'line #' && lowerCol !== '#' && 
               lowerCol !== 'line' && lowerCol !== 'line number' &&
               lowerCol !== 'speaker' && lowerCol !== 'utterance' &&
               lowerCol !== 'time' && lowerCol !== 'timestamp';
      });

      const hasAnnotatorNotes = noteColumns.some(col => {
        const note = getAnnotatorNoteForLine(annotator, lineNumber, col);
        return note !== null && note.trim() !== '';
      });

      return hasAnnotatorNotes;
    });
  };

  // Helper function to get annotator note for specific line and column
  const getAnnotatorNoteForLine = (annotator: AnnotatorData, lineNumber: number, columnName: string): string | null => {
    if (!annotator.notesData || !annotator.notesData.notes) return null;
    
    // Find the note entry for this line number
    const noteEntry = annotator.notesData.notes.find(note => {
      // Try multiple possible line number column names
      const lineValue = note['Line #'] || note['#'] || note['Line'] || note['line'] || note['LINE'] || note['Line Number'];
      if (lineValue === null || lineValue === undefined) return false;
      
      // Handle both string and number line values
      const parsedLine = typeof lineValue === 'string' ? parseInt(lineValue) : Number(lineValue);
      return !isNaN(parsedLine) && parsedLine === lineNumber;
    });
    
    if (!noteEntry) return null;
    
    // Get the note from the specified column
    const noteValue = noteEntry[columnName];
    
    // Check for various empty/null states - but don't exclude numbers that might be 0 or NaN strings that represent actual content
    if (noteValue === null || noteValue === undefined || noteValue === '') {
      return null;
    }
    
    // Convert to string and check if it's meaningful content
    const stringValue = String(noteValue).trim();
    if (stringValue === '' || stringValue.toLowerCase() === 'nan' || stringValue.toLowerCase() === 'null' || stringValue.toLowerCase() === 'undefined') {
      return null;
    }
    
    return stringValue;
  };

  // Function to handle notes popup
  const handleNotesClick = (lineNumber: number, speaker: string, utterance: string) => {
    setSelectedNotesLine({ lineNumber, speaker, utterance });
  };

  // Function to get all notes for a specific line
  const getAllNotesForLine = (lineNumber: number) => {
    const allNotes: Array<{
      annotatorName: string;
      annotatorType: 'user' | 'imported';
      notes: Array<{
        title?: string;
        content: string;
        abstract?: string;
        fullContent?: string;
      }>;
    }> = [];

    // Get current user notes
    if (currentUserHasNotes && getNoteDisplayText) {
      const row = tableData.find(r => r.col2 === lineNumber);
      if (row && row.noteIds && row.noteIds.trim() !== '') {
        const userNotes = notes
          .filter(note => note.lineNumbers.includes(lineNumber))
          .map(note => ({
            title: note.title,
            content: note.content_1 + (note.content_2 ? '\n\n' + note.content_2 : ''),
            abstract: note.title,
            fullContent: note.content_1 + (note.content_2 ? '\n\n' + note.content_2 : '')
          }));

        if (userNotes.length > 0) {
          allNotes.push({
            annotatorName: `You (t${getTranscriptNumber()})`,
            annotatorType: 'user',
            notes: userNotes
          });
        }
      }
    }

    // Get imported annotators' notes
    otherAnnotators.forEach(annotator => {
      if (!annotator.notesData) return;

      const noteColumns = Object.keys(annotator.notesData.notes?.[0] || {}).filter(col => {
        const lowerCol = col.toLowerCase();
        return lowerCol !== 'line #' && lowerCol !== '#' && 
               lowerCol !== 'line' && lowerCol !== 'line number' &&
               lowerCol !== 'speaker' && lowerCol !== 'utterance' &&
               lowerCol !== 'time' && lowerCol !== 'timestamp';
      });

      const annotatorNotes = noteColumns
        .map(col => getAnnotatorNoteForLine(annotator, lineNumber, col))
        .filter((note): note is string => note !== null && note.trim() !== '')
        .map(note => {
          const abstract = note.includes('||') ? note.split('||')[0].trim() : note;
          const fullContent = note.includes('||') ? note.split('||')[1].trim() : note;
          return {
            content: note,
            abstract,
            fullContent: note.includes('||') ? fullContent : note
          };
        });

      if (annotatorNotes.length > 0) {
        allNotes.push({
          annotatorName: annotator.display_name,
          annotatorType: 'imported',
          notes: annotatorNotes
        });
      }
    });

    return allNotes;
  };

  // Calculate IRR statistics
  const calculateIRRStats = useMemo((): IRRStats[] => {
    if (!selectedCategory || otherAnnotators.length === 0) return [];
    
    const stats: IRRStats[] = [];
    const features = getFeaturesForCategory(selectedCategory);
    
    features.forEach(feature => {
      let agreements = 0;
      let totalComparisons = 0;
      
      // Collect all annotator values for this feature across all lines
      const currentAnnotatorValues: (string | number | boolean | null)[] = [];
      
      // Initialize arrays for each annotator
      const annotatorArrays: Array<(string | number | boolean | null)[]> = Array(otherAnnotators.length + 1).fill(null).map(() => []);
      
      tableData.forEach(row => {
        if (!isTableRowSelectable(row)) return;
        
        const currentValue = getCurrentAnnotatorValue(row.col2, selectedCategory, feature);
        currentAnnotatorValues.push(currentValue);
        annotatorArrays[0].push(currentValue);
        
        // Calculate pairwise comparisons for simple agreement
        if (currentValue !== null) {
          otherAnnotators.forEach((annotator, index) => {
            const otherValue = getAnnotatorValue(annotator, row.col2, selectedCategory, feature);
            annotatorArrays[index + 1].push(otherValue);
            
            if (otherValue !== null) {
              totalComparisons++;
              // Convert to boolean for comparison
              const currentBool = convertToBoolean(currentValue);
              const otherBool = convertToBoolean(otherValue);
              if (currentBool === otherBool) {
                agreements++;
              }
            }
          });
        } else {
          // Still need to fill arrays for other annotators even if current is null
          otherAnnotators.forEach((annotator, index) => {
            const otherValue = getAnnotatorValue(annotator, row.col2, selectedCategory, feature);
            annotatorArrays[index + 1].push(otherValue);
          });
        }
      });
      
      // Calculate Cohen's Kappa (only for two annotators)
      let cohensKappa: number | null = null;
      if (otherAnnotators.length === 1) {
        cohensKappa = calculateCohensKappa(annotatorArrays[0], annotatorArrays[1]);
      }
      
      // Calculate Krippendorff's Alpha (for any number of annotators)
      const krippendorffsAlpha = calculateKrippendorffsAlpha(annotatorArrays);
      
      const agreement = totalComparisons > 0 ? (agreements / totalComparisons) * 100 : 0;
      
      stats.push({
        feature,
        category: selectedCategory,
        agreement: Math.round(agreement * 100) / 100,
        totalComparisons,
        agreements,
        disagreements: totalComparisons - agreements,
        cohensKappa,
        krippendorffsAlpha
      });
    });
    
    return stats.sort((a, b) => b.agreement - a.agreement);
  }, [selectedCategory, otherAnnotators, tableData, getFeaturesForCategory, getCurrentAnnotatorValue, getAnnotatorValue, isTableRowSelectable]);

  const allCategories = getAllCategories();
  const displayTableData = getDisplayTableData();
  

  return (
    <div className="min-h-screen bg-gray-50 p-1">
      <div className="w-full">
        {/* Compact Header */}
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Compare with Other Annotators</h1>
            <p className="text-gray-600 text-xs">
              Multi-annotator comparison and Inter-Rater Reliability analysis
            </p>
          </div>
          <button
            onClick={onBack}
            className="px-3 py-1 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
          >
            ← Back to Transcript
          </button>
        </div>

        {/* Main Content */}
        <div className="space-y-2">

          {/* Combined Upload and Loaded Annotators Section - Compact */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {/* Upload Section */}
            <div className="bg-white rounded-lg border shadow-sm p-2">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-800">Upload Annotator Data</h2>
                <button
                  onClick={() => setShowUploadSection(!showUploadSection)}
                  className="px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-xs font-medium"
                >
                  {showUploadSection ? 'Hide' : 'Show'}
                </button>
              </div>
              
              {/* Always show upload input */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="file"
                  multiple
                  accept=".xlsx"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="block w-full text-sm text-black file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
              
              {/* Pull from Cloud section */}
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={handleShowAvailableAnnotators}
                  disabled={pullingFromCloud}
                  className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-xs font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pullingFromCloud ? (
                    <>
                      <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Loading...
                    </>
                  ) : (
                    <>
                      ☁️ Select from Cloud
                    </>
                  )}
                </button>
                <span className="text-xs text-gray-500">or upload local files above</span>
              </div>
              
              {uploadStatus.type && (
                <div className={`p-2 rounded-md mb-2 text-xs ${
                  uploadStatus.type === 'success' 
                    ? 'bg-green-50 border border-green-200 text-green-800' 
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  {uploadStatus.message}
                </div>
              )}
              
              {showUploadSection && (
                <>
                  <div className="text-sm text-black">
                    <p className="font-medium mb-1">Expected format:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li><strong>XLSX files exported from this annotation tool</strong></li>
                      <li>Each sheet = one category (Conceptual, Discursive, etc.)</li>
                      <li>Columns: Line #, Speaker, Utterance, [feature columns]</li>
                      <li>Values: 1 = true, 0 = false, empty = false</li>
                    </ul>
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                      <strong>✓ Compatible:</strong> Upload the XLSX files that this tool exports for other annotators.
                    </div>
                    
                    {otherAnnotators.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to clear all uploaded annotator data? This cannot be undone.')) {
                                setOtherAnnotators([]);
                                const transcriptNumber = getTranscriptNumber();
                                const storageKey = `annotator-data-${transcriptNumber}`;
                                localStorage.removeItem(storageKey);
                                setShowUploadSection(true);
                                setUploadStatus({ type: 'success', message: 'All annotator data cleared successfully.' });
                              }
                            }}
                            className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-xs font-medium"
                          >
                            Clear All Data
                          </button>
                          <button
                            onClick={() => {
                              // Force clear localStorage and reload to test new parsing
                              const transcriptNumber = getTranscriptNumber();
                              const storageKey = `annotator-data-${transcriptNumber}`;
                              localStorage.removeItem(storageKey);
                              window.location.reload();
                            }}
                            className="px-3 py-1 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors text-xs font-medium"
                          >
                            Force Reload
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Loaded Annotators */}
            <div className="bg-white rounded-lg border shadow-sm p-2">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-800">
                  Loaded Annotators ({otherAnnotators.length})
                </h2>

              </div>
              
              {otherAnnotators.length > 0 ? (
                <>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {otherAnnotators.map((annotator) => (
                      <div key={annotator.annotator_id} className="p-2 bg-gray-50 rounded border">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 text-sm">{annotator.display_name}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              <span className="inline-flex items-center gap-1">
                                📁 {annotator.filename}
                              </span>
                              <span className="ml-3 inline-flex items-center gap-1">
                                📊 {Object.keys(annotator.categories).length} categories, {Object.keys(annotator.annotations).length} annotations
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              📅 Uploaded: {new Date(annotator.upload_date).toLocaleDateString()}
                            </div>
                            {annotator.description && (
                              <div className="text-xs text-gray-600 mt-1">
                                <strong>Description:</strong> {annotator.description}
                              </div>
                            )}
                            {annotator.notes && (
                              <div className="text-xs text-gray-600 mt-1">
                                <strong>Notes:</strong> {annotator.notes}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 ml-2">
                            <button
                              onClick={() => handleEditExpert(annotator)}
                              className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-medium"
                              title="Edit expert information"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => removeAnnotator(annotator.annotator_id)}
                              className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs font-medium"
                              title="Remove expert"
                            >
                              🗑️ Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-gray-500 border-t border-gray-200 pt-2">
                    💾 Data persists when you close and return to this page
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <svg className="mx-auto w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                  <p className="text-sm">No annotators loaded yet</p>
                  <p className="text-xs text-gray-400 mt-1">Upload XLSX files to begin comparison</p>
                </div>
              )}
            </div>
          </div>

          {/* Expert Naming Modal */}
          {showNamingModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 w-96">
                <h3 className="text-lg font-semibold text-black mb-4">Name This Expert</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Expert Name:</label>
                    <input
                      type="text"
                      value={expertName}
                      onChange={(e) => setExpertName(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      placeholder="Enter expert name..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Description (optional):</label>
                    <textarea
                      value={expertDescription}
                      onChange={(e) => setExpertDescription(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      rows={2}
                      placeholder="Enter description, role, or other information..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Notes (optional):</label>
                    <textarea
                      value={expertNotes}
                      onChange={(e) => setExpertNotes(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      rows={2}
                      placeholder="Enter any additional notes or comments..."
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowNamingModal(false)}
                    className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveExpertInfo}
                    disabled={!expertName.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
                  >
                    Save Expert
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Expert Edit Modal */}
          {showEditModal && editingAnnotator && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 w-96 max-h-[90vh] overflow-y-auto">
                <h3 className="text-lg font-semibold text-black mb-4">Edit Expert Information</h3>
                
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="text-sm text-blue-800">
                    <strong>File:</strong> {editingAnnotator.filename}
                  </div>
                  <div className="text-sm text-blue-600 mt-1">
                    Uploaded: {new Date(editingAnnotator.upload_date).toLocaleDateString()}
                  </div>
                  <div className="text-sm text-blue-600">
                    {Object.keys(editingAnnotator.categories).length} categories, {Object.keys(editingAnnotator.annotations).length} annotations
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Expert Name:</label>
                    <input
                      type="text"
                      value={expertName}
                      onChange={(e) => setExpertName(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      placeholder="Enter expert name..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Description (optional):</label>
                    <textarea
                      value={expertDescription}
                      onChange={(e) => setExpertDescription(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      rows={2}
                      placeholder="Enter description, role, or other information..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">Notes (optional):</label>
                    <textarea
                      value={expertNotes}
                      onChange={(e) => setExpertNotes(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-black"
                      rows={3}
                      placeholder="Enter any additional notes, observations, or comments about this expert's annotations..."
                    />
                  </div>
                </div>
                
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingAnnotator(null);
                      setExpertName('');
                      setExpertDescription('');
                      setExpertNotes('');
                    }}
                    className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEditedExpert}
                    disabled={!expertName.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

                    {/* Combined Controls and Comparison Table */}
          {otherAnnotators.length > 0 ? (
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden mx-1">
              {/* Header Section */}
              <div className="p-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-800 mb-3">
                  {selectedCategory 
                    ? `📊 Comparison Results - ${selectedCategory}`
                    : '📋 Transcript Comparison View'
                  }
                </h2>

                {/* Category Selection */}
                <div className="mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Category:</label>
                    <select
                      value={selectedCategory || ''}
                      onChange={(e) => {
                        setSelectedCategory(e.target.value || null);
                      }}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 min-w-48"
                    >
                      <option value="">Select Category</option>
                      {allCategories.map(category => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Combined Controls Row - Buttons and Search */}
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  {/* Toggle Buttons */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => setShowOnlyDifferences(!showOnlyDifferences)}
                      disabled={!selectedCategory}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                        showOnlyDifferences
                          ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg'
                          : 'bg-white border-2 border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${showOnlyDifferences ? 'bg-white' : 'bg-red-400'}`}></span>
                        Show Only Differences
                      </span>
                    </button>

                    <button
                      onClick={() => setShowOnlyAnnotated(!showOnlyAnnotated)}
                      disabled={!selectedCategory}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                        showOnlyAnnotated
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                          : 'bg-white border-2 border-blue-200 text-blue-600 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${showOnlyAnnotated ? 'bg-white' : 'bg-blue-400'}`}></span>
                        Show Only Annotated
                      </span>
                    </button>

                    <button
                      onClick={() => setShowStatistics(!showStatistics)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 ${
                        showStatistics
                          ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg'
                          : 'bg-white border-2 border-green-200 text-green-600 hover:border-green-300 hover:bg-green-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${showStatistics ? 'bg-white' : 'bg-green-400'}`}></span>
                        Show IRR Statistics
                      </span>
                    </button>

                    {(currentUserHasNotes || hasNotesData) && (
                      <button
                        onClick={() => setShowNotesInTable(!showNotesInTable)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 ${
                          showNotesInTable
                            ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg'
                            : 'bg-white border-2 border-purple-200 text-purple-600 hover:border-purple-300 hover:bg-purple-50'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${showNotesInTable ? 'bg-white' : 'bg-purple-400'}`}></span>
                          📝 Show Notes in Table
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Large Search Bar */}
                  <div className="flex-1 min-w-80">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Search Line# & Utterance:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Search line numbers and utterances..."
                      />
                      
                      {searchTerm && (
                        <>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => navigateSearch('prev')}
                              disabled={searchResults.length === 0}
                              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                            >
                              ↑ Prev
                            </button>
                            <button
                              onClick={() => navigateSearch('next')}
                              disabled={searchResults.length === 0}
                              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                            >
                              ↓ Next
                            </button>
                          </div>
                          
                          <div className="text-sm text-gray-600 px-3 py-2 bg-gray-100 rounded-lg min-w-16 text-center">
                            {searchResults.length > 0 ? `${currentSearchIndex + 1}/${searchResults.length}` : '0/0'}
                          </div>
                          
                          <button
                            onClick={() => setSearchTerm('')}
                            className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                          >
                            Clear
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

                            {/* IRR Statistics */}
              {showStatistics && selectedCategory && (
                <div className="p-3 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">
                    📊 IRR Statistics - {selectedCategory}
                  </h3>
                  
                  {/* Information Panel */}
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <h4 className="text-sm font-semibold text-blue-800 mb-2">Statistical Measures Explained:</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-blue-700">
                      <div>
                        <strong>Agreement %:</strong> Simple percentage of cases where annotators agreed
                      </div>
                      <div>
                        <strong>Cohen&apos;s Kappa:</strong> Agreement corrected for chance (2 annotators only). Values: &lt;0.2 (poor), 0.2-0.4 (fair), 0.4-0.6 (moderate), 0.6-0.8 (good), &gt;0.8 (excellent). Shows N/A when only one category is used (no opportunity for disagreement).
                      </div>
                      <div>
                        <strong>Krippendorff&apos;s Alpha:</strong> Reliability measure for any number of annotators. Values: &lt;0.67 (tentative), 0.67-0.8 (acceptable), &gt;0.8 (good). Note: Values near 0 indicate agreement no better than chance, especially in high-prevalence scenarios.
                      </div>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse shadow-sm">
                      <thead className="bg-gradient-to-r from-gray-700 to-gray-600 text-white">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider border border-gray-500">Feature</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Agreement %</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Agreements</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Disagreements</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Total</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Cohen&apos;s κ</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider border border-gray-500">Krippendorff&apos;s α</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {calculateIRRStats.map((stat, index) => (
                          <tr key={stat.feature} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-opacity-80 transition-colors`}>
                            <td className="px-3 py-2 text-sm font-medium text-gray-900 border border-gray-300">{stat.feature}</td>
                            <td className="px-3 py-2 text-center border border-gray-300">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                stat.agreement >= 80 ? 'bg-green-100 text-green-800' :
                                stat.agreement >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {stat.agreement.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-sm text-gray-900 border border-gray-300">{stat.agreements}</td>
                            <td className="px-3 py-2 text-center text-sm text-gray-900 border border-gray-300">{stat.disagreements}</td>
                            <td className="px-3 py-2 text-center text-sm text-gray-900 border border-gray-300">{stat.totalComparisons}</td>
                            <td className="px-3 py-2 text-center border border-gray-300">
                              {stat.cohensKappa !== null ? (
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                  stat.cohensKappa >= 0.8 ? 'bg-green-100 text-green-800' :
                                  stat.cohensKappa >= 0.6 ? 'bg-blue-100 text-blue-800' :
                                  stat.cohensKappa >= 0.4 ? 'bg-yellow-100 text-yellow-800' :
                                  stat.cohensKappa >= 0.2 ? 'bg-orange-100 text-orange-800' :
                                  'bg-red-100 text-red-800'
                                }`} title={`${stat.cohensKappa >= 0.8 ? 'Excellent' : stat.cohensKappa >= 0.6 ? 'Good' : stat.cohensKappa >= 0.4 ? 'Moderate' : stat.cohensKappa >= 0.2 ? 'Fair' : 'Poor'} agreement`}>
                                  {stat.cohensKappa.toFixed(3)}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs" title="Cohen's Kappa only available for exactly 2 annotators">N/A</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center border border-gray-300">
                              {stat.krippendorffsAlpha !== null ? (
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                  stat.krippendorffsAlpha >= 0.8 ? 'bg-green-100 text-green-800' :
                                  stat.krippendorffsAlpha >= 0.67 ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-red-100 text-red-800'
                                                                 }`} title={`${stat.krippendorffsAlpha >= 0.8 ? 'Good' : stat.krippendorffsAlpha >= 0.67 ? 'Acceptable' : 'Tentative'} reliability`}>
                                  {stat.krippendorffsAlpha.toFixed(4)}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">N/A</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {calculateIRRStats.length === 0 && (
                    <p className="text-center text-gray-500 py-8">No data available for IRR calculation</p>
                  )}
                </div>
              )}
              
              {/* Comparison Table */}
              <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-30 bg-gradient-to-r from-gray-700 to-gray-600 text-white">
                    <tr>
                      <th className="p-3 border border-gray-500 text-left font-semibold">Line #</th>
                      <th className="p-3 border border-gray-500 text-left font-semibold">Speaker</th>
                      <th className="p-3 border border-gray-500 text-left font-semibold">Utterance</th>
                      
                      {/* Notes columns - show if enabled */}
                      {showNotesInTable && (
                        <>
                          {/* Current user notes column */}
                          {currentUserHasNotes && (
                            <th className="p-3 border border-gray-500 text-center font-semibold min-w-48 bg-gradient-to-r from-purple-700 to-purple-600">
                              <div className="text-white font-semibold">You (t{getTranscriptNumber()})</div>
                              <div className="text-xs text-purple-100 mt-1">Notes</div>
                            </th>
                          )}
                          
                          {/* Other annotators' notes columns */}
                          {otherAnnotators.filter(annotator => annotator.notesData).map((annotator) => (
                            <th key={`notes-${annotator.annotator_id}`} className="p-3 border border-gray-500 text-center font-semibold min-w-48 bg-gradient-to-r from-purple-700 to-purple-600">
                              <div className="text-white font-semibold">{annotator.display_name}</div>
                              <div className="text-xs text-purple-100 mt-1">Notes</div>
                            </th>
                          ))}
                        </>
                      )}
                      
                      {selectedCategory && getFeaturesForCategory(selectedCategory).map(feature => (
                        <th key={feature} className="p-3 border border-gray-500 text-center font-semibold min-w-32">
                          <div className="text-white font-semibold">{feature}</div>
                          <div className="flex flex-col gap-1 mt-2">
                            <div className="px-2 py-1 bg-blue-600 text-blue-100 rounded text-xs font-medium border border-blue-400">
                              You (t{getTranscriptNumber()})
                            </div>
                            {otherAnnotators.map((annotator) => (
                              <div key={annotator.annotator_id} className="px-2 py-1 bg-green-600 text-green-100 rounded text-xs font-medium border border-green-400">
                                {annotator.display_name}
                              </div>
                            ))}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayTableData.map((row, index) => {
                      const isSelectable = isTableRowSelectable(row);
                      
                      // Use speaker colors like in transcript page
                      let rowBgColor = speakerColors[row.col5] || 'bg-gray-100';
                      
                      // Highlight current search result
                      const isCurrentSearchResult = searchTerm.trim() && 
                        searchResults.length > 0 && 
                        currentSearchIndex >= 0 &&
                        searchResults[currentSearchIndex] &&
                        row.col2 === searchResults[currentSearchIndex].col2;
                      
                      if (isCurrentSearchResult) {
                        rowBgColor = 'bg-yellow-200 border-2 border-yellow-400';
                      }
                      
                      return (
                        <tr key={index} className={`${rowBgColor} hover:bg-opacity-80 transition-colors`} data-line={row.col2}>
                          <td className="p-3 border border-gray-300 font-mono font-semibold text-gray-900">
                            {row.col2}
                          </td>
                          <td className="p-3 border border-gray-300 font-medium text-gray-900">
                            {row.col5}
                          </td>
                          <td className="p-3 border border-gray-300 text-gray-900" title={row.col6}>
                            {row.col6}
                          </td>
                          
                          {/* Notes columns - show if enabled */}
                          {showNotesInTable && (
                            <>
                              {/* Current user notes column */}
                              {currentUserHasNotes && (
                                <td 
                                  className="p-2 border border-gray-300 cursor-pointer hover:bg-purple-50"
                                  onClick={() => handleNotesClick(row.col2, row.col5, row.col6)}
                                  title="Click to view all notes for this line"
                                >
                                  <div className="text-xs">
                                    {getCurrentUserNotesForLine(row.col2)}
                                  </div>
                                </td>
                              )}
                              
                              {/* Other annotators' notes columns */}
                              {otherAnnotators.filter(annotator => annotator.notesData).map((annotator) => {
                                                // Get all note columns from this annotator's data
                const noteColumns = Object.keys(annotator.notesData?.notes?.[0] || {}).filter(col => {
                  const lowerCol = col.toLowerCase();
                  return lowerCol !== 'line #' && lowerCol !== '#' && 
                         lowerCol !== 'line' && lowerCol !== 'line number' &&
                         lowerCol !== 'speaker' && lowerCol !== 'utterance' &&
                         lowerCol !== 'time' && lowerCol !== 'timestamp';
                });
                                
                                // Get all notes for this line from all note columns
                                const allNotes = noteColumns
                                  .map(col => getAnnotatorNoteForLine(annotator, row.col2, col))
                                  .filter((note): note is string => note !== null && note.trim() !== '');
                                
                                return (
                                  <td 
                                    key={`notes-${annotator.annotator_id}`} 
                                    className="p-2 border border-gray-300 cursor-pointer hover:bg-purple-50"
                                    onClick={() => handleNotesClick(row.col2, row.col5, row.col6)}
                                    title="Click to view all notes for this line"
                                  >
                                    {allNotes.length > 0 ? (
                                      <div className="space-y-1">
                                        {allNotes.map((note, noteIndex) => {
                                          // Extract abstract (before ||) for display
                                          const abstract = note.includes('||') ? note.split('||')[0].trim() : note;
                                          const hasFullContent = note.includes('||');
                                          
                                          return (
                                            <div 
                                              key={noteIndex} 
                                              className={`px-2 py-1 rounded text-xs ${
                                                hasFullContent 
                                                  ? 'bg-purple-100 border border-purple-300 text-purple-800' 
                                                  : 'bg-gray-100 border border-gray-300 text-gray-700'
                                              }`}
                                              title={hasFullContent ? 'Click to see full content' : abstract}
                                            >
                                              {abstract.length > 50 ? `${abstract.substring(0, 50)}...` : abstract}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="text-center text-gray-400 text-xs py-2">—</div>
                                    )}
                                  </td>
                                );
                              })}
                            </>
                          )}
                          
                          {/* Feature columns with stacked annotations */}
                          {selectedCategory && getFeaturesForCategory(selectedCategory).map(feature => {
                            // Convert col2 to number for proper line number handling
                            const lineNumber = typeof row.col2 === 'number' ? row.col2 : parseInt(String(row.col2) || '0');
                            
                            // For non-selectable rows, show "-" instead of annotation values
                            const currentValue = isSelectable ? getCurrentAnnotatorValue(lineNumber, selectedCategory, feature) : '-';
                            
                            const otherValues = otherAnnotators.map((annotator) => {
                              const value = isSelectable ? getAnnotatorValue(annotator, lineNumber, selectedCategory, feature) : '-';
                              return value;
                            });
                            

                            
                            // Check if there are any disagreements for this feature (exclude "-" values)
                            const allValues = [currentValue, ...otherValues].filter(v => v !== null && v !== undefined && v !== '-');
                            const hasDisagreement = allValues.length > 1 && !allValues.every(v => v === allValues[0]);
                            
                            return (
                              <td key={feature} className={`p-2 border border-gray-300 text-center ${
                                !isSelectable ? 'bg-gray-50' : hasDisagreement ? 'bg-red-200 border-red-400 border-2' : ''
                              }`}>
                                {/* Always show stacked layout with boxes */}
                                <div className="flex flex-col gap-2">
                                  {/* Current user value on top */}
                                  <div className={`px-3 py-2 rounded-md border text-sm font-medium ${
                                    currentValue === '-' ? 'bg-gray-200 border-gray-400 text-gray-600' :
                                    hasDisagreement ? (
                                      currentValue === true ? 'bg-blue-100 border-blue-400 text-blue-800 border-2' : 
                                      currentValue === false ? 'bg-gray-100 border-gray-400 text-gray-700 border-2' : 
                                      'bg-gray-50 border-gray-300 text-gray-400 border-2'
                                    ) : (
                                      currentValue === true ? 'bg-blue-100 border-blue-300 text-blue-800' : 
                                      currentValue === false ? 'bg-gray-100 border-gray-300 text-gray-700' : 
                                      'bg-gray-50 border-gray-200 text-gray-400'
                                    )
                                  }`}>
                                    {currentValue === '-' ? '-' : currentValue === true ? 'Yes' : currentValue === false ? 'No' : '—'}
                                  </div>
                                  {/* Expert values stacked below */}
                                  {otherAnnotators.map((annotator, annotatorIndex) => {
                                    const otherValue = otherValues[annotatorIndex];
                                    return (
                                      <div key={annotator.annotator_id} className={`px-3 py-2 rounded-md border text-sm font-medium ${
                                        otherValue === '-' ? 'bg-gray-200 border-gray-400 text-gray-600' :
                                        hasDisagreement ? (
                                          otherValue === true ? 'bg-green-100 border-green-400 text-green-800 border-2' : 
                                          otherValue === false ? 'bg-gray-100 border-gray-400 text-gray-700 border-2' : 
                                          'bg-gray-50 border-gray-300 text-gray-400 border-2'
                                        ) : (
                                          otherValue === true ? 'bg-green-100 border-green-300 text-green-800' : 
                                          otherValue === false ? 'bg-gray-100 border-gray-300 text-gray-700' : 
                                          'bg-gray-50 border-gray-200 text-gray-400'
                                        )
                                      }`}>
                                        {otherValue === '-' ? '-' : otherValue === true ? 'Yes' : otherValue === false ? 'No' : '—'}
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border shadow-sm p-6 text-center mx-1">
              <svg className="mx-auto w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">No Annotator Data Loaded</h3>
              <p className="text-gray-600 text-sm">Upload annotation files from other annotators to begin comparison.</p>
            </div>
          )}
        </div>
      </div>

      {/* Expert Naming Modal */}
      {showNamingModal && pendingAnnotatorData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Name This Expert
                </h3>
                <button
                  onClick={() => {
                    setShowNamingModal(false);
                    setPendingAnnotatorData(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="bg-blue-50 px-3 py-2 rounded-lg border-l-4 border-blue-400">
                  <div className="text-sm text-blue-800">
                    <strong>File:</strong> {pendingAnnotatorData.annotator_id}
                  </div>
                  <div className="text-sm text-blue-600 mt-1">
                    {Object.keys(pendingAnnotatorData.categories).length} categories, {Object.keys(pendingAnnotatorData.annotations).length} annotations
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Annotator Username or Display Name
                  </label>
                  <input
                    type="text"
                    value={expertName}
                    onChange={(e) => setExpertName(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter username (e.g., abcdef)"
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the username or identifier for this annotator (this will be displayed in the comparison table)
                  </p>
                  <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                    <strong>💡 Tip:</strong> For automatic username detection, name your files like:<br/>
                    <code className="text-blue-900">username_transcript_t01_annotations_timestamp.xlsx</code>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    value={expertDescription}
                    onChange={(e) => setExpertDescription(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter description (e.g., Mathematics Education Expert)"
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowNamingModal(false);
                    setPendingAnnotatorData(null);
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveExpertInfo}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Save Expert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes Popup Modal */}
      {selectedNotesLine && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-purple-700 to-purple-600">
                <div className="flex items-center justify-between">
                  <div className="text-white">
                    <h3 className="text-xl font-bold mb-2">
                      📝 All Annotations for Line {selectedNotesLine.lineNumber}
                    </h3>
                    <div className="bg-orange-100 text-orange-800 p-3 rounded-lg border-l-4 border-orange-400">
                      <div className="text-sm">
                        <strong>🎯 Evidence</strong>
                      </div>
                      <div className="mt-2">
                        <span className="font-medium">Speaker:</span> {selectedNotesLine.speaker}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium">Utterance:</span> {selectedNotesLine.utterance}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedNotesLine(null)}
                    className="text-white hover:text-gray-200 transition-colors p-2"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {(() => {
                  const allNotesForLine = getAllNotesForLine(selectedNotesLine.lineNumber);
                  const totalNotes = allNotesForLine.reduce((sum, annotator) => sum + annotator.notes.length, 0);
                  
                  return (
                    <>
                      {/* Summary */}
                      <div className="mb-6 p-4 bg-purple-50 rounded-lg border-l-4 border-purple-400">
                        <div className="flex items-center justify-between">
                          <div className="text-purple-800">
                            <strong>Summary:</strong> {allNotesForLine.filter(a => a.annotatorType === 'user').reduce((sum, a) => sum + a.notes.length, 0)} user, {allNotesForLine.filter(a => a.annotatorType === 'imported').reduce((sum, a) => sum + a.notes.length, 0)} expert, {totalNotes} total notes
                          </div>
                          <div className="flex items-center gap-2 text-sm text-purple-600">
                            <span>📄 Scroll horizontally</span>
                          </div>
                        </div>
                      </div>

                      {/* Notes Grid */}
                      {allNotesForLine.length > 0 ? (
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                          {allNotesForLine.map((annotatorNotes, index) => (
                            <div key={index} className="bg-white border rounded-lg shadow-sm">
                              {/* Annotator Header */}
                              <div className={`p-4 rounded-t-lg ${
                                annotatorNotes.annotatorType === 'user' 
                                  ? 'bg-gradient-to-r from-blue-500 to-blue-600' 
                                  : 'bg-gradient-to-r from-green-500 to-green-600'
                              }`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-xl">
                                    {annotatorNotes.annotatorType === 'user' ? '👤' : '🤖'}
                                  </span>
                                  <h4 className="font-bold text-white">
                                    {annotatorNotes.annotatorName} ({annotatorNotes.annotatorType === 'user' ? 'User' : 'Expert'})
                                  </h4>
                                </div>
                              </div>

                              {/* Notes Content */}
                              <div className="p-4 space-y-4">
                                {annotatorNotes.notes.map((note, noteIndex) => (
                                  <div key={noteIndex} className="border rounded-lg overflow-hidden">
                                    {/* Abstract */}
                                    <div className="p-3 bg-purple-50">
                                      <div className="text-xs text-gray-600 font-medium mb-1">ABSTRACT</div>
                                      <div className="bg-purple-200 text-purple-800 px-3 py-2 rounded text-sm">
                                        {note.title || note.abstract || 'No title'}
                                      </div>
                                    </div>

                                    {/* Full Content */}
                                    <div className="p-3 bg-gray-50">
                                      <div className="text-xs text-gray-600 font-medium mb-2">FULL CONTENT</div>
                                      <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                                        {note.fullContent || note.content || 'No content available'}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-500">
                          <svg className="mx-auto w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <h3 className="text-lg font-semibold text-gray-800 mb-2">No Notes Found</h3>
                          <p className="text-gray-600 text-sm">No notes are available for line {selectedNotesLine.lineNumber}.</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Annotator Selection Modal */}
      {showAnnotatorSelection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Select Annotators to Compare</h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose which annotators&apos; work you want to pull from cloud storage for comparison:
            </p>
            
            {Object.keys(groupedFiles).length > 0 ? (
              <div className="space-y-4 mb-6">
                {Object.entries(groupedFiles).map(([userId, transcripts]) => (
                  <div key={userId} className="border border-gray-200 rounded-lg">
                    <button
                      onClick={() => {
                        const newExpanded = new Set(expandedUsers);
                        if (newExpanded.has(userId)) {
                          newExpanded.delete(userId);
                        } else {
                          newExpanded.add(userId);
                        }
                        setExpandedUsers(newExpanded);
                      }}
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div>
                        <div className="font-medium text-gray-900">{userId}</div>
                        <div className="text-sm text-gray-600">{transcripts.length} transcript{transcripts.length !== 1 ? 's' : ''}</div>
                      </div>
                      <svg
                        className={`w-5 h-5 transition-transform ${expandedUsers.has(userId) ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {expandedUsers.has(userId) && (
                      <div className="border-t border-gray-200 p-3 space-y-2">
                        {transcripts.map((transcript, index) => {
                          const transcriptKey = `${userId}_${transcript.fileName}`;
                          return (
                            <label key={index} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedTranscripts.has(transcriptKey)}
                                onChange={(e) => {
                                  const newSelected = new Set(selectedTranscripts);
                                  if (e.target.checked) {
                                    newSelected.add(transcriptKey);
                                  } else {
                                    newSelected.delete(transcriptKey);
                                  }
                                  setSelectedTranscripts(newSelected);
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <div className="font-medium text-gray-900 text-sm">{transcript.fileName}</div>
                                <div className="text-xs text-gray-600">
                                  {new Date(transcript.uploadedAt).toLocaleDateString()} • {Math.round(transcript.size / 1024)} KB
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500">
                No annotators found for this transcript.
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAnnotatorSelection(false);
                  setSelectedTranscripts(new Set());
                  setExpandedUsers(new Set());
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handlePullSelectedTranscripts}
                disabled={selectedTranscripts.size === 0 || pullingFromCloud}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {pullingFromCloud ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Pulling...
                  </>
                ) : (
                  `Pull ${selectedTranscripts.size} Transcript${selectedTranscripts.size !== 1 ? 's' : ''}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
