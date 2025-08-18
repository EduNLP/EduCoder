/* eslint-disable */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Tab1 from "../../tabs/tab1";
import Papa from "papaparse";
import AnnotationPanel, { AnnotationData, FeatureDetails } from "../../components/AnnotationPanel";
import { read, utils, writeFile, write } from "xlsx";
import FeaturePopup from "../../components/FeaturePopup";
import React from "react";
// Create a simple debounce function to replace lodash dependency
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): T {
  let timeout: NodeJS.Timeout;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
}
import LLMComparisonView from "../../components/LLMComparisonView";
import LLMAnalysisComparisonView from "../../components/LLMAnalysisComparisonView";
import ExpertsComparisonView from "../../components/ExpertsComparisonView";
import UnifiedComparisonView from "../../components/UnifiedComparisonView";
import MultiAnnotatorComparisonView from "../../components/MultiAnnotatorComparisonView";
import LLMAnnotationModal from "../../components/LLMAnnotationModal";
import { loadTranscriptData, safeStorageGet, safeStorageSet, safeStorageRemove, optimizeAnnotationData, restoreAnnotationData } from "../../utils/storageUtils";


interface CsvRow {
  [key: string]: string | undefined; // Allow any column name
}

// Interface for a single learning goal note
interface Note {
  content_1: string;
  content_2: string;
  id: number;      // Numeric ID for the learning goal note
  title: string;   // User-editable title
  rowIndices: number[]; // Track which rows this learning goal note belongs to
  lineNumbers: number[]; // Explicit line numbers for this note (redundant but ensures preservation)
}

// Updated table row interface
interface TableRow {
  col1: string | null; // Segment (optional)
  col2: number;
  col3: string;
  col4: string;
  col5: string;
  col6: string;
  col7: string; // Selectable field
  noteIds: string; // This will store the comma-separated learning goal note IDs (read-only)
  [key: string]: string | number | null; // For extra columns
}

// Types for the feature columns component
interface FeatureColumnsProps {
  rowData: TableRow;
  selectedFeature: string | null;
  annotationData: AnnotationData | null;
  isSelectable: boolean; // Only prop needed for determining if row is annotatable
  onFeatureChange: (lineNumber: number, code: string, value: boolean) => void;
  onHoverChange?: (isHovering: boolean) => void;
}

// Utility functions to filter out unwanted metadata columns
const METADATA_COLUMNS = ['lastSaved', 'lastActivity', 'lastModifiedBy'];

const cleanTableRow = (row: any): any => {
  const cleanedRow = { ...row };
  METADATA_COLUMNS.forEach(col => {
    delete cleanedRow[col];
  });
  return cleanedRow;
};

const filterMetadataColumns = (columns: string[]): string[] => {
  return columns.filter(col => !METADATA_COLUMNS.includes(col));
};

export default function TranscriptPage() {
  const params = useParams();
  const router = useRouter();
  const number = params.number as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(true);
  const [speakerColors, setSpeakerColors] = useState<{ [key: string]: string }>({});
  const [availableSegment, setAvailableSegment] = useState<string []>([]);
  const [whichSegment, setWhichSegment] = useState<string>("full_transcript");
  const [speakerFilter, setSpeakerFilter] = useState<string>("full_transcript"); // "full_transcript", "student_only", "teacher_only", or specific speaker
  const [showSpeakerDropdown, setShowSpeakerDropdown] = useState(false);
  const [showSegmentDropdown, setShowSegmentDropdown] = useState(false);
  const [showPromptPanel, setShowPromptPanel] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false); // Track if real data has been loaded
  const [columnVisibility, setColumnVisibility] = useState({
    segment: true,
    lineNumber: true,
    start: false,
    end: false,
    speaker: true,
    utterance: true,
    notes: true
  });
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [extraColumnVisibility, setExtraColumnVisibility] = useState<{[key: string]: boolean}>({});
  const [hasSegmentColumn, setHasSegmentColumn] = useState(false);
  const [hasSelectableColumn, setHasSelectableColumn] = useState(false);
  const [forceReloadAnnotations, setForceReloadAnnotations] = useState(0);
  const [lastFeatureDefinitionCheck, setLastFeatureDefinitionCheck] = useState(Date.now());

  // CRITICAL FIX: Move dropdown states to parent level to persist across re-renders
  const [expandedDropdowns, setExpandedDropdowns] = useState<{[key: string]: boolean}>({});
  const [dropdownPositions, setDropdownPositions] = useState<{[key: string]: 'bottom' | 'top' | 'left' | 'right'}>({});
  const [openedDropdowns, setOpenedDropdowns] = useState<{[key: string]: boolean}>({});
  const [showFeatureOverview, setShowFeatureOverview] = useState<string | null>(null);
  const [showLLMComparison, setShowLLMComparison] = useState(false);
  const [llmAnnotationData, setLlmAnnotationData] = useState<AnnotationData | null>(null);
  const [separateLlmAnnotationData, setSeparateLlmAnnotationData] = useState<{[provider: string]: AnnotationData} | null>(null);
  const [showLLMAnalysisComparison, setShowLLMAnalysisComparison] = useState(false);
  const [llmAnalysisData, setLlmAnalysisData] = useState<{
    notes: Record<string, unknown>[];
    transcript: Record<string, unknown>[];
  } | null>(null);
  const [showExpertsComparison, setShowExpertsComparison] = useState(false);
  const [expertsAnnotationData, setExpertsAnnotationData] = useState<{
    notes: Record<string, unknown>[];
    transcript: Record<string, unknown>[];
  } | null>(null);
  const [showUnifiedComparison, setShowUnifiedComparison] = useState(false);
  const [showMultiAnnotatorComparison, setShowMultiAnnotatorComparison] = useState(false);
  const [showLLMAnnotationModal, setShowLLMAnnotationModal] = useState(false);
  const [featureDefinitionsForLLM, setFeatureDefinitionsForLLM] = useState<{ categories: string[], features: { [category: string]: any[] } }>({ categories: [], features: {} });

  // Add these state variables at the top of your component
  const [leftPanelWidth, setLeftPanelWidth] = useState("33.33%");
  const [centerPanelWidth, setCenterPanelWidth] = useState("66.67%");
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  // Add state for in-place editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingInstruction, setIsEditingInstruction] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [tempInstruction, setTempInstruction] = useState("");

  // Add state for LLM cell popup
  const [showLLMCellPopup, setShowLLMCellPopup] = useState<{
    lineNumber: number;
    provider: string;
    category: string;
    rowData: TableRow;
    position: { x: number; y: number };
    dropdownPosition: 'top' | 'bottom' | 'left' | 'right';
  } | null>(null);

  // Add state for hidden columns dropdown
  const [showHiddenColumnsDropdown, setShowHiddenColumnsDropdown] = useState(false);
  
  // Add modal states for annotation window and definition popup
  const [showAnnotationWindow, setShowAnnotationWindow] = useState<{
    rowData: TableRow;
    category: string;
    codes: string[];
    rowAnnotations: {[key: string]: boolean};
  } | null>(null);
  
  const [selectedDefinition, setSelectedDefinition] = useState<{
    code: string;
    definition: string;
    example1: string;
    nonexample1: string;
    position: { x: number; y: number };
  } | null>(null);
  

  
  // Add useEffect to handle click outside for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (showSpeakerDropdown && !target.closest('[data-dropdown="speaker"]')) {
        setShowSpeakerDropdown(false);
      }
      
      if (showSegmentDropdown && !target.closest('[data-dropdown="segment"]')) {
        setShowSegmentDropdown(false);
      }
      
      if (showLLMCellPopup && !target.closest('[data-llm-popup="true"]')) {
        setShowLLMCellPopup(null);
      }
    };

    if (showSpeakerDropdown || showSegmentDropdown || showLLMCellPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSpeakerDropdown, showSegmentDropdown, showLLMCellPopup]);

  // Add modal handlers
  const handleOpenAnnotationWindow = (rowData: TableRow, category: string, codes: string[], rowAnnotations: {[key: string]: boolean}) => {
    setShowAnnotationWindow({ rowData, category, codes, rowAnnotations });
  };

  const handleCloseAnnotationWindow = () => {
    setShowAnnotationWindow(null);
  };

  const handleOpenDefinition = (code: string, definition: string, example1: string, nonexample1: string, position: { x: number; y: number }) => {
    setSelectedDefinition({ code, definition, example1, nonexample1, position });
  };

  const handleCloseDefinition = () => {
    setSelectedDefinition(null);
  };

  // Search functionality state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentSearchMatch, setCurrentSearchMatch] = useState<number>(-1);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);

  // Add these handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const newWidth = (e.clientX / window.innerWidth) * 100;
        // Set limits (min 15%, max 85%)
        const limitedWidth = Math.min(Math.max(newWidth, 15), 85);
        setLeftPanelWidth(`${limitedWidth}%`);
        
        // Recalculate center panel width (no right panel)
        const remainingWidth = 100 - limitedWidth;
        setCenterPanelWidth(`${remainingWidth}%`);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
    };

    if (isDraggingLeft) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingLeft, leftPanelWidth]);

  const toggleColumnVisibility = (columnKey: keyof typeof columnVisibility) => {
    setColumnVisibility(prev => ({
      ...prev,
      [columnKey]: !prev[columnKey]
    }));
  };
  
  const toggleExtraColumnVisibility = (columnName: string) => {
    setExtraColumnVisibility(prev => ({
      ...prev,
      [columnName]: !prev[columnName]
    }));
  };
      // Store notes separately from table data
  const [notes, setNotes] = useState<Note[]>([]);
  const [nextNoteId, setNextNoteId] = useState(1);
  // Add this with your other state declarations
  const [availableIds, setAvailableIds] = useState<number[]>([]);
  const [annotationData, setAnnotationData] = useState<AnnotationData | null>(null);
  
  // State for new learning goal note creation
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  
  // Track which learning goal note title is currently being edited
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null);
  
  // NEW: Track which learning goal note lines are being edited
  const [editingLinesId, setEditingLinesId] = useState<number | null>(null);
  const [tempSelectedRows, setTempSelectedRows] = useState<number[]>([]);

  // Updated table state - Initialize empty to prevent placeholder data corruption
  const [tableData, setTableData] = useState<TableRow[]>([]);

  // Helper function to detect placeholder data patterns
  const isPlaceholderData = (data: TableRow[]): boolean => {
    if (!data || data.length === 0) return false;
    
    // Check if data contains placeholder patterns like "Row X Col Y"
    const hasPlaceholderPattern = data.some(row => {
      return (
        (typeof row.col5 === 'string' && row.col5.includes('Row ') && row.col5.includes(' Col ')) ||
        (typeof row.col6 === 'string' && row.col6.includes('Row ') && row.col6.includes(' Col '))
      );
    });
    
    return hasPlaceholderPattern;
  };

  // Function to check if a table row is selectable by row data
  const isTableRowSelectable = (rowData: TableRow): boolean => {
    // If no "Selectable" column exists in the data, all rows are annotatable
    if (!hasSelectableColumn) {
      return true;
    }
    
    // Check col7 first (primary location for selectable data)
    if (rowData.col7 && rowData.col7.trim() !== '') {
      const selectableValue = rowData.col7.toLowerCase().trim();
      return selectableValue === "true" || selectableValue === "yes" || selectableValue === "1";
    }
    
    // Fallback: check extra columns for selectable data (edge case handling)
    for (const [key, value] of Object.entries(rowData)) {
      if (key.toLowerCase().includes('selectable') && typeof value === 'string' && value.trim() !== '') {
        const selectableValue = value.toLowerCase().trim();
        return selectableValue === "true" || selectableValue === "yes" || selectableValue === "1";
      }
    }
    
    // If no selectable value found or empty, default to not selectable
    return false;
  };

  // Function to parse learning goal note IDs from a comma-separated string
  const parseNoteIds = (idString: string): number[] => {
    return idString
      .split(',')
      .map(id => id.trim())
      .filter(id => id !== "")
      .map(id => parseInt(id, 10))
      .filter(id => !isNaN(id));
  };

  // Toggle selection of a row
  const toggleRowSelection = (col2Value: number) => {
    // Find the row data to check if it's selectable
    const rowData = tableData.find(row => row.col2 === col2Value);
    if (!rowData || !isTableRowSelectable(rowData)) return;
    
    if (selectedRows.includes(col2Value)) {
      setSelectedRows(selectedRows.filter(id => id !== col2Value));
    } else {
      setSelectedRows([...selectedRows, col2Value]);
    }
  };

  // Toggle selection of a row for line number editing
  const toggleTempRowSelection = (col2Value: number) => {
    // Find the row data to check if it's selectable
    const rowData = tableData.find(row => row.col2 === col2Value);
    if (!rowData || !isTableRowSelectable(rowData)) return;
    
      if (tempSelectedRows.includes(col2Value)) {
        setTempSelectedRows(tempSelectedRows.filter(id => id !== col2Value));
      } else {
        setTempSelectedRows([...tempSelectedRows, col2Value]);
    }
  };

  // Start the learning goal note creation process
  const startNoteCreation = () => {
    setIsCreatingNote(true);
    setSelectedRows([]);
  };
  
  // Cancel learning goal note creation
  const cancelNoteCreation = () => {
    setIsCreatingNote(false);
    setSelectedRows([]);
  };

  // Search functionality
  const handleSearch = (term: string) => {
    setSearchTerm(term);
    
    if (!term.trim()) {
      setSearchMatches([]);
      setCurrentSearchMatch(-1);
      return;
    }

    const filteredData = tableData.filter(rowData => {
      if (whichSegment === 'student_only') {
        return rowData.col5.includes('Student');
      }
      return whichSegment === 'full_transcript' || rowData.col1 === whichSegment;
    });

    const matches: number[] = [];
    const searchLower = term.toLowerCase();
    
    // Check if search term is a number (line number search)
    const isLineNumber = /^\d+$/.test(term.trim());
    
    filteredData.forEach((row, index) => {
      if (isLineNumber) {
        // Search by line number
        if (row.col2.toString() === term.trim()) {
          matches.push(index);
        }
      } else {
        // Search by utterance text
        if (row.col6.toLowerCase().includes(searchLower)) {
          matches.push(index);
        }
      }
    });
    
    setSearchMatches(matches);
    setCurrentSearchMatch(matches.length > 0 ? 0 : -1);
    
    // Scroll to first match
    if (matches.length > 0) {
      scrollToMatch(matches[0]);
    }
  };

  const navigateSearch = (direction: 'next' | 'prev') => {
    if (searchMatches.length === 0) return;
    
    let nextIndex = currentSearchMatch;
    if (direction === 'next') {
      nextIndex = (currentSearchMatch + 1) % searchMatches.length;
    } else {
      nextIndex = currentSearchMatch === 0 ? searchMatches.length - 1 : currentSearchMatch - 1;
    }
    
    setCurrentSearchMatch(nextIndex);
    scrollToMatch(searchMatches[nextIndex]);
  };

  const scrollToMatch = (tableIndex: number) => {
    const rowElement = document.querySelector(`[data-row-index="${tableIndex}"]`);
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setSearchMatches([]);
    setCurrentSearchMatch(-1);
  };

  // Function to create a new learning goal note with specific rows
  const handleCreateNoteWithRows = (rowIndices: number[]) => {
    if (rowIndices.length === 0) return;
    
    // Use an available ID if one exists, otherwise use nextNoteId
    let noteId: number;
    if (availableIds.length > 0) {
      // Get the first available ID
      noteId = availableIds[0];
      // Remove this ID from the available list
      setAvailableIds(availableIds.slice(1));
    } else {
      // No available IDs, use the next sequential ID
      noteId = nextNoteId;
      setNextNoteId(noteId + 1);
    }
    
    // Get the line numbers (col2 values) for the selected row indices
    const lineNumbers = rowIndices.map(index => tableData[index]?.col2).filter(lineNum => lineNum !== undefined);
    
    // Create new learning goal note with empty title (will be named in edit window)
    const updatedNotes = [...notes, {
      id: noteId,
      title: "",
      content_1: "",
      content_2: "",
      rowIndices: rowIndices,
      lineNumbers: lineNumbers
    }];
    
    // Update table data learning goal note IDs
    const updatedTableData = tableData.map((row, index) => ({
      ...row,
      noteIds: rowIndices.includes(index) 
        ? [...parseNoteIds(row.noteIds), noteId].join(', ')
        : row.noteIds
    }));
    
    setTableData(updatedTableData);
    setNotes(updatedNotes);
    
    // Automatically open the note for editing
    const noteRows = updatedNotes[updatedNotes.length - 1].rowIndices.map(rowIndex => {
      if (rowIndex >= 0 && rowIndex < tableData.length) {
        return tableData[rowIndex];
      }
      return null;
    }).filter((row): row is TableRow => row !== null);
    
    setSelectedNotePopup({ 
      note: updatedNotes[updatedNotes.length - 1], 
      noteRows 
    });
  };

  // Function to create a new learning goal note
  const handleCreateNote = () => {
    if (selectedRows.length === 0) return;
    
    // Use an available ID if one exists, otherwise use nextNoteId
    let noteId: number;
    if (availableIds.length > 0) {
      // Get the first available ID
      noteId = availableIds[0];
      // Remove this ID from the available list
      setAvailableIds(availableIds.slice(1));
    } else {
      // No available IDs, use the next sequential ID
      noteId = nextNoteId;
      setNextNoteId(noteId + 1);
    }
    
    // Convert selectedRows (col2 values) to array indices for storage
    const rowIndices = selectedRows.map(col2Value => 
      tableData.findIndex(row => row.col2 === col2Value)
    ).filter(index => index !== -1);
    
    // Create new learning goal note with empty title (will be named in edit window)
    const updatedNotes = [...notes, {
      id: noteId,
      title: "",
      content_1: "",
      content_2: "",
      rowIndices: rowIndices,
      lineNumbers: selectedRows
    }];
    
    // Update table data learning goal note IDs
    const updatedTableData = tableData.map(row => ({
      ...row,
      noteIds: selectedRows.includes(row.col2) 
        ? [...parseNoteIds(row.noteIds), noteId].join(', ')
        : row.noteIds
    }));
    
    setTableData(updatedTableData);
    setNotes(updatedNotes);
    setSelectedRows([]);
    setIsCreatingNote(false);
    
    // Automatically open the note for editing
    const noteRows = updatedNotes[updatedNotes.length - 1].rowIndices.map(rowIndex => {
      if (rowIndex >= 0 && rowIndex < tableData.length) {
        return tableData[rowIndex];
      }
      return null;
    }).filter((row): row is TableRow => row !== null);
    
    setSelectedNotePopup({ 
      note: updatedNotes[updatedNotes.length - 1], 
      noteRows 
    });
  };

  // Handle learning goal note content changes
  const handleNoteContentChange1 = (noteId: number, value: string) => {
    const updatedNotes = [...notes];
    const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
    
    if (noteIndex !== -1) {
      updatedNotes[noteIndex].content_1 = value;
      setNotes(updatedNotes);
    }
  };

  const handleNoteContentChange2 = (noteId: number, value: string) => {
    const updatedNotes = [...notes];
    const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
    
    if (noteIndex !== -1) {
      updatedNotes[noteIndex].content_2 = value;
      setNotes(updatedNotes);
    }
  };

  // Start editing a title
  const startTitleEdit = (noteId: number) => {
    setEditingTitleId(noteId);
  };

  // Update title text as user types
  const updateTitleText = (noteId: number, newTitle: string) => {
    const updatedNotes = [...notes];
    const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
    
    if (noteIndex !== -1) {
      updatedNotes[noteIndex].title = newTitle;
      setNotes(updatedNotes);
    }
  };

  // Save title edit - if empty, use "no title"
  const saveTitleEdit = (noteId: number) => {
    const updatedNotes = [...notes];
    const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
    
    if (noteIndex !== -1) {
      // Use "no title" if the input is empty
      if (updatedNotes[noteIndex].title.trim() === "") {
        updatedNotes[noteIndex].title = "no title";
      }
      setNotes(updatedNotes);
    }
    
    // Exit edit mode
    setEditingTitleId(null);
  };

  // Cancel editing without saving changes
  const cancelTitleEdit = (noteId: number) => {
    const originalNote = notes.find(note => note.id === noteId);
    if (originalNote && originalNote.title.trim() === "") {
      // If they were editing a blank title, restore "no title"
      const updatedNotes = [...notes];
      const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
      if (noteIndex !== -1) {
        updatedNotes[noteIndex].title = "no title";
        setNotes(updatedNotes);
      }
    }
    setEditingTitleId(null);
  };

  // NEW: Functions for learning goal note line number editing
  
  // Start editing line numbers
  const startLinesEdit = (noteId: number) => {
    const note = notes.find(note => note.id === noteId);
    if (note) {
      // Convert rowIndices (array indices) to col2 values for selection
      const col2Values = note.rowIndices.map(index => 
        tableData[index]?.col2
      ).filter(col2 => col2 !== undefined);
      
      setTempSelectedRows(col2Values);
      setEditingLinesId(noteId);
    }
  };
  
  // Save line number edits
  const saveLinesEdit = (noteId: number) => {
    // Find the learning goal note to update
    const updatedNotes = [...notes];
    const noteIndex = updatedNotes.findIndex(note => note.id === noteId);
    
    if (noteIndex === -1) {
      setEditingLinesId(null);
      return;
    }
    
    const oldRowIndices = updatedNotes[noteIndex].rowIndices;
    
    // Convert tempSelectedRows (col2 values) to array indices
    const newRowIndices = tempSelectedRows.map(col2Value => 
      tableData.findIndex(row => row.col2 === col2Value)
    ).filter(index => index !== -1);
    
    // Update the learning goal note's row indices and line numbers
    updatedNotes[noteIndex].rowIndices = newRowIndices;
    updatedNotes[noteIndex].lineNumbers = tempSelectedRows;
    
    // Update table data
    const updatedTableData = [...tableData];
    
    // Remove learning goal note ID from rows that were removed
    oldRowIndices.forEach(rowIndex => {
      if (!newRowIndices.includes(rowIndex)) {
        const currentIds = parseNoteIds(updatedTableData[rowIndex].noteIds);
        const updatedIds = currentIds.filter(id => id !== noteId);
        updatedTableData[rowIndex].noteIds = updatedIds.join(', ');
      }
    });
    
    // Add learning goal note ID to rows that were added
    newRowIndices.forEach(rowIndex => {
      const currentIds = parseNoteIds(updatedTableData[rowIndex].noteIds);
      if (!currentIds.includes(noteId)) {
        const newIds = [...currentIds, noteId];
        updatedTableData[rowIndex].noteIds = newIds.join(', ');
      }
    });
    
    setTableData(updatedTableData);
    setNotes(updatedNotes);
    setEditingLinesId(null);
    setTempSelectedRows([]);
  };
  
  // Cancel line number editing
  const cancelLinesEdit = () => {
    setEditingLinesId(null);
    setTempSelectedRows([]);
  };

  // Delete a learning goal note from the analysis panel
  const handleDeleteNote = (noteId: number) => {
    // Find the learning goal note to delete
    const noteToDelete = notes.find(note => note.id === noteId);
    if (!noteToDelete) return;
    
    // Remove ID from all associated rows
    const updatedData = [...tableData];
    noteToDelete.rowIndices.forEach(rowIndex => {
      const currentIds = parseNoteIds(updatedData[rowIndex].noteIds);
      const updatedIds = currentIds.filter(id => id !== noteId);
      updatedData[rowIndex].noteIds = updatedIds.join(', ');
    });
    
    // Remove learning goal note from notes collection
    const updatedNotes = notes.filter(note => note.id !== noteId);
    
    // Add this ID to the available list
    setAvailableIds([...availableIds, noteId]);
    
    setTableData(updatedData);
    setNotes(updatedNotes);
  };

  // Save Function (Stores data locally)
  const handleSave = async () => {
    const dataToSave = { 
      tableData, 
      notes, 
      nextNoteId, 
      availableIds,
      hasSegmentColumn,
      hasSelectableColumn, // CRITICAL FIX: Preserve this flag when saving
      extraColumns,
      extraColumnVisibility
    };
    console.log(dataToSave);
    await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
    alert("Data saved successfully!");
  };


  
  // State for upload status
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  // State for user ID prompt
  const [showUserIdPrompt, setShowUserIdPrompt] = useState(false);
  const [userId, setUserId] = useState('');
  const [userIdError, setUserIdError] = useState('');



  // Save data before page unload
  useEffect(() => {
    const handleBeforeUnload = async (event: BeforeUnloadEvent) => {
      console.log('Page unloading...');
      
      // Only save if real data has been loaded to prevent overwriting good data
      if (dataLoaded && tableData.length > 0) {
        console.log('Real data loaded, saving all data before unload...');
        
        try {
          // Force save all data immediately before page closes
          const dataToSave = { 
            tableData, 
            notes, 
            nextNoteId, 
            availableIds,
            hasSegmentColumn,
            hasSelectableColumn, // CRITICAL FIX: Preserve this flag when saving
            extraColumns,
            extraColumnVisibility
          };
          
          // Save table data
          await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
          console.log('Table data saved before unload');
          
          // Save annotation data
          if (annotationData) {
            const optimizedAnnotations = optimizeAnnotationData(annotationData);
            await safeStorageSet(`annotations-${number}`, JSON.stringify(optimizedAnnotations));
            console.log('Annotation data saved before unload');
          }
          
          // Save notes data
          if (notes && notes.length > 0) {
            await safeStorageSet(`notes-${number}`, JSON.stringify(notes));
            console.log('Notes saved before unload');
          }
          
          // Save nextNoteId and availableIds
          if (nextNoteId !== undefined) {
            await safeStorageSet(`nextNoteId-${number}`, JSON.stringify(nextNoteId));
          }
          if (availableIds && availableIds.length > 0) {
            await safeStorageSet(`availableIds-${number}`, JSON.stringify(availableIds));
          }
        } catch (error) {
          console.error('Error saving data before unload:', error);
        }
      } else {
        console.log('No real data loaded, skipping save before unload to prevent overwriting good data');
      }
      
      // Also save grade level and lesson goal before unload
      try {
        const getResponse = await fetch(`/api/update-content?transcriptId=t${number}`);
        const { content: currentContent } = await getResponse.json();
        
        const updatedContent = {
          ...currentContent,
          title: title,
          instruction: instruction
        };
        
        // Always save to localStorage first (immediate and reliable)
        await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
        console.log('Content saved to localStorage before unload');
        
        // Also save to settings file before unload (if possible)
        try {
          const settingsResponse = await fetch('/api/save-transcript-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptId: `t${number}`,
              title: title,
              instruction: instruction
            }),
          });
          
          const settingsResult = await settingsResponse.json();
          if (settingsResult.success) {
            console.log('Content saved to settings file before unload');
          }
        } catch {
          // Silently fail for settings file save during unload
        }
        
        // Try to save to server as well
        const payload = JSON.stringify({
          transcriptId: `t${number}`,
          content: updatedContent,
        });
        
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/update-content', payload);
        } else {
          // Fallback for browsers that don't support sendBeacon
          fetch('/api/update-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
          });
        }
      } catch (error) {
        console.error('Error saving content before unload:', error);
        // Even if server save fails, try to save to localStorage
        try {
          const existingContentRaw = await safeStorageGet(`t${number}-content.json`);
          const existingContent = existingContentRaw ? JSON.parse(existingContentRaw) : {};
          const updatedContent = {
            ...existingContent,
            title: title,
            instruction: instruction
          };
          await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
          console.log('Content saved to localStorage as fallback before unload');
          
          // Also try to save to settings file as fallback
          try {
            const settingsResponse = await fetch('/api/save-transcript-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                transcriptId: `t${number}`,
                title: title,
                instruction: instruction
              }),
            });
            
            const settingsResult = await settingsResponse.json();
            if (settingsResult.success) {
              console.log('Content saved to settings file as fallback before unload');
            }
          } catch {
            // Silently fail for settings file save during unload
          }
        } catch (storageError) {
          console.error('Failed to save content to localStorage before unload:', storageError);
        }
      }
      
      console.log("Data saved before page unload");
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tableData, notes, nextNoteId, availableIds, annotationData, title, instruction, hasSegmentColumn, hasSelectableColumn, extraColumns, extraColumnVisibility, number]);

  // Also save data when component unmounts (when navigating to other pages)
  useEffect(() => {
    return () => {
      // This cleanup function runs when component unmounts
      // Only save if real data has been loaded to prevent overwriting good data
      if (typeof window !== 'undefined' && dataLoaded && tableData.length > 0) {
        console.log('Component unmounting, saving all data...');
        
        // Use async function within cleanup but don't await it to avoid blocking
        const saveDataOnUnmount = async () => {
          try {
            const dataToSave = { 
              tableData, 
              notes, 
              nextNoteId, 
              availableIds,
              hasSegmentColumn,
              hasSelectableColumn,
              extraColumns,
              extraColumnVisibility
            };
            
            // Use safe storage that handles quota exceeded errors
            await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
            
            if (annotationData) {
              const optimizedAnnotations = optimizeAnnotationData(annotationData);
              await safeStorageSet(`annotations-${number}`, JSON.stringify(optimizedAnnotations));
            }
            
            if (notes && notes.length > 0) {
              await safeStorageSet(`notes-${number}`, JSON.stringify(notes));
            }
            
            if (nextNoteId !== undefined) {
              await safeStorageSet(`nextNoteId-${number}`, JSON.stringify(nextNoteId));
            }
            
            if (availableIds && availableIds.length > 0) {
              await safeStorageSet(`availableIds-${number}`, JSON.stringify(availableIds));
            }
            
            console.log('All data saved during component unmount');
          } catch (error) {
            console.error('Error saving data during unmount:', error);
          }
        };
        
        // Start saving but don't wait for it
        saveDataOnUnmount();
      } else {
        console.log('Component unmounting, but no real data loaded - skipping save to prevent overwriting good data');
      }
    };
  }, [tableData, notes, nextNoteId, availableIds, annotationData, hasSegmentColumn, hasSelectableColumn, extraColumns, extraColumnVisibility, number, dataLoaded]);

  // Auto-save grade level and lesson goal when they change
  useEffect(() => {
    const saveContentToServer = async () => {
      if (!mounted) return; // Don't save during initial load
      
      try {
        // Get current content first
        const getResponse = await fetch(`/api/update-content?transcriptId=t${number}`);
        const { content: currentContent } = await getResponse.json();
        
        // Update with current values
        const updatedContent = {
          ...currentContent,
          title: title,
          instruction: instruction
        };
        
        const response = await fetch('/api/update-content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcriptId: `t${number}`,
            content: updatedContent,
          }),
        });

        const result = await response.json();
        
        if (response.ok) {
          console.log('Grade level and lesson goal auto-saved successfully');
          
          // If public folder is not writable, save to localStorage
          if (result.useLocalStorage || result.localStorageOnly) {
            try {
              await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
              console.log('Grade level and lesson goal auto-saved to localStorage');
            } catch (storageError) {
              console.error('Failed to auto-save to localStorage:', storageError);
            }
          }
          
          // Also auto-save to local settings file (silently)
          try {
            const settingsResponse = await fetch('/api/save-transcript-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                transcriptId: `t${number}`,
                title: title,
                instruction: instruction
              }),
            });
            
            const settingsResult = await settingsResponse.json();
            if (settingsResult.success) {
              console.log('Grade level and lesson goal auto-saved to local settings file');
            }
          } catch {
            // Silently fail for auto-save to settings file
          }
        } else {
          console.warn('Failed to auto-save grade level and lesson goal');
        }
      } catch (error) {
        console.error('Error auto-saving grade level and lesson goal:', error);
        // Try to save to localStorage as fallback
        try {
          const existingContentRaw = await safeStorageGet(`t${number}-content.json`);
          const existingContent = existingContentRaw ? JSON.parse(existingContentRaw) : {};
          const updatedContent = {
            ...existingContent,
            title: title,
            instruction: instruction
          };
          await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
          console.log('Grade level and lesson goal auto-saved to localStorage as fallback');
          
          // Also try to save to settings file as fallback (silently)
          try {
            const settingsResponse = await fetch('/api/save-transcript-settings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                transcriptId: `t${number}`,
                title: title,
                instruction: instruction
              }),
            });
            
            const settingsResult = await settingsResponse.json();
            if (settingsResult.success) {
              console.log('Grade level and lesson goal auto-saved to settings file as fallback');
            }
          } catch {
            // Silently fail for auto-save to settings file
          }
        } catch (storageError) {
          console.error('Failed to auto-save to localStorage fallback:', storageError);
        }
      }
    };

    // Debounce the save operation to avoid too many API calls
    const timeoutId = setTimeout(saveContentToServer, 2000); // Save 2 seconds after last change
    
    return () => clearTimeout(timeoutId);
  }, [title, instruction, number, mounted]);

  // Auto-save annotation data whenever it changes
  useEffect(() => {
    if (!mounted || !annotationData || !dataLoaded || loading) return; // Don't save during initial load, if no real data loaded, or while loading
    
    console.log('Annotation data changed, auto-saving...');
    const saveAnnotations = async () => {
      try {
        const optimizedAnnotations = optimizeAnnotationData(annotationData);
        await safeStorageSet(`annotations-${number}`, JSON.stringify(optimizedAnnotations));
        console.log('Annotations auto-saved successfully');
      } catch (error) {
        console.error('Error auto-saving annotations:', error);
      }
    };

    // Debounce the save operation to avoid too many saves
    const timeoutId = setTimeout(saveAnnotations, 1000); // Save 1 second after last change
    
    return () => clearTimeout(timeoutId);
  }, [annotationData, number, mounted, dataLoaded, loading]);

  // Auto-save notes whenever they change
  useEffect(() => {
    if (!mounted || !notes || !dataLoaded || loading) return; // Don't save during initial load, if no real data loaded, or while loading
    
    console.log('Notes changed, auto-saving...');
    const saveNotes = async () => {
      try {
        await safeStorageSet(`notes-${number}`, JSON.stringify(notes));
        console.log('Notes auto-saved successfully');
      } catch (error) {
        console.error('Error auto-saving notes:', error);
      }
    };

    // Debounce the save operation
    const timeoutId = setTimeout(saveNotes, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [notes, number, mounted, dataLoaded, loading]);

  // Auto-save table data whenever it changes
  useEffect(() => {
    if (!mounted || !tableData || tableData.length === 0 || !dataLoaded || loading) return; // Don't save during initial load, if no real data loaded, or while loading
    
    console.log('Table data changed, auto-saving...');
    const saveTableData = async () => {
      try {
        const dataToSave = { 
          tableData, 
          notes, 
          nextNoteId, 
          availableIds,
          hasSegmentColumn,
          hasSelectableColumn,
          extraColumns,
          extraColumnVisibility
        };
        await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
        console.log('Table data auto-saved successfully');
      } catch (error) {
        console.error('Error auto-saving table data:', error);
      }
    };

    // Debounce the save operation
    const timeoutId = setTimeout(saveTableData, 2000); // Longer debounce for table data
    
    return () => clearTimeout(timeoutId);
  }, [tableData, notes, nextNoteId, availableIds, hasSegmentColumn, hasSelectableColumn, extraColumns, extraColumnVisibility, number, mounted, dataLoaded, loading]);

  // Submit Function (Sends data to backend)
  const handleSubmit = async () => {
    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableData, notes, transcriptNumber: number }),
      });

      if (response.ok) {
        alert("Data submitted successfully!");
      } else {
        alert("Failed to submit data.");
      }
    } catch (error) {
      console.error("Submission error:", error);
      alert("An error occurred while submitting.");
    }
  };

  // Get learning goal note title by ID for display in the table
  const getNoteDisplayById = (noteId: number): string => {
    const note = notes.find(note => note.id === noteId);
    return note ? note.id.toString() : "";
  };

  const handleSegmentClick = (segment: string) => {
    setWhichSegment(segment);
  };

  // Function to get display titles for the table - now returns clickable elements
  const getNoteDisplayText = (idsString: string, rowIndex: number): React.ReactNode => {
    const ids = parseNoteIds(idsString);
    if (ids.length === 0) return "—";
    
    return ids.map((id: number, index: number) => {
      const note = notes.find(n => n.id === id);
      if (!note) return null;
      
      return (
        <React.Fragment key={id}>
          {index > 0 && ", "}
          <button
            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium"
            onClick={(e) => {
              e.stopPropagation(); // Prevent the cell click handler from firing
              const noteRows = generateNoteRows(note);
              setSelectedNotePopup({ note, noteRows });
              // Reset edit mode when opening a note
              setIsNoteInEditMode(false);
              setNoteEditBuffer(null);
            }}
            title={`Click to view note: ${note.title}`}
          >
            {note.title || `Note ${id}`}
          </button>
        </React.Fragment>
      );
    }).filter(Boolean);
  };

  const [showNotesColumn, setShowNotesColumn] = useState(true);

  // ALLOWED_SHEETS will be loaded dynamically from API
let ALLOWED_SHEETS: string[] = []; // Will be populated dynamically

  // Function to save all annotations
  const saveAllAnnotations = async (data: AnnotationData | null) => {
    if (!data) return;
    const optimizedAnnotations = optimizeAnnotationData(data);
    await safeStorageSet(`annotations-${number}`, JSON.stringify(optimizedAnnotations));
  };

  // Simplified and optimized toggle component with enhanced contrast
  const FeatureToggle = React.memo(({ 
    isChecked, 
    isDisabled,
    onToggle 
  }: { 
    isChecked: boolean;
    isDisabled: boolean;
    onToggle: (checked: boolean) => void;
  }) => (
    <div 
      className={`
        inline-flex rounded-md select-none shadow-sm
        ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <button
        type="button"
        disabled={isDisabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isDisabled) onToggle(false);
        }}
        className={`
          min-w-[32px] px-3 py-1 text-xs font-bold rounded-l-md border-r border-white/20
          transition-all duration-150 ease-in-out
          ${isChecked 
            ? 'bg-gray-200 text-gray-500 hover:bg-gray-300' 
            : 'bg-red-600 text-white shadow-md hover:bg-red-700 active:bg-red-800'
          }
          ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        No
      </button>
      <button
        type="button"
        disabled={isDisabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isDisabled) onToggle(true);
        }}
          className={`
          min-w-[32px] px-3 py-1 text-xs font-bold rounded-r-md
          transition-all duration-150 ease-in-out
          ${isChecked 
            ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-700 active:bg-emerald-800' 
            : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
          }
          ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        Yes
      </button>
    </div>
  ), (prev, next) => 
    prev.isChecked === next.isChecked && 
    prev.isDisabled === next.isDisabled
  );
  FeatureToggle.displayName = 'FeatureToggle';



  // Optimize feature columns component
  const FeatureColumns = React.memo(({ 
    rowData,
    selectedFeature,
    annotationData,
    isSelectable,
    onFeatureChange,
    onHoverChange
  }: FeatureColumnsProps) => {
    // Early return if no data
    if (!selectedFeature || !annotationData?.[selectedFeature]) return null;

    const rowAnnotations = annotationData[selectedFeature].annotations[rowData.col2 - 1] || {};
    const codes = annotationData[selectedFeature].codes;
    
    return (
      <>
        {codes.map((code: string) => (
          <td key={code} className="px-1 py-1 border border-black border-2 text-center">
              <FeatureToggle
              isChecked={!!rowAnnotations[code]}
              isDisabled={!isSelectable} // Use only isSelectable check
              onToggle={(checked) => onFeatureChange(rowData.col2 - 1, code, checked)}
              />
          </td>
        ))}
      </>
    );
  }, (prev, next) => {
    // Simplified comparison focusing only on what matters
    if (prev.selectedFeature !== next.selectedFeature) return false;
    if (prev.isSelectable !== next.isSelectable) return false;
    if (!prev.selectedFeature || !next.selectedFeature) return true;

    const prevRow = prev.annotationData?.[prev.selectedFeature]?.annotations[prev.rowData.col2 - 1];
    const nextRow = next.annotationData?.[next.selectedFeature]?.annotations[next.rowData.col2 - 1];
    return prevRow === nextRow; // Direct reference comparison instead of JSON stringify
  });

  // LLM Feature Cell component for displaying LLM annotations (read-only)
  const LLMFeatureCell = React.memo(({ 
    rowData,
    category,
    llmAnnotationData,
    provider,
    onCellClick
  }: {
    rowData: TableRow;
    category: string;
    llmAnnotationData: AnnotationData | null;
    provider: string;
    onCellClick?: (lineNumber: number, provider: string, category: string, event: React.MouseEvent) => void;
  }) => {
    if (!llmAnnotationData?.[category]) {
      return (
        <td className="px-2 py-1 border border-black border-2 text-center bg-purple-50">
          <div className="text-xs text-gray-400">—</div>
        </td>
      );
    }

    const rowIndex = rowData.col2 - 1;
    const rowAnnotations = llmAnnotationData[category].annotations[rowIndex] || {};
    const codes = llmAnnotationData[category].codes;
    
    // Count how many features are marked as true
    const trueCount = codes.filter(code => rowAnnotations[code]).length;
    const totalCount = codes.length;
    
    // Determine cell color based on annotation density and provider
    const getCellColor = () => {
      const baseClass = provider.includes('ChatGPT') ? 'bg-green' : 'bg-purple';
      if (trueCount === 0) return `${baseClass}-50`;
      if (trueCount === totalCount) return `${baseClass}-200`;
      return `${baseClass}-100`;
    };
    
    const getTextColor = () => {
      return provider.includes('ChatGPT') ? 'text-green-700' : 'text-purple-700';
    };

    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (onCellClick) {
        onCellClick(rowData.col2, provider, category, e);
      }
    };
    
    return (
      <td 
        className={`px-2 py-1 border border-black border-2 text-center cursor-pointer hover:opacity-80 transition-opacity ${getCellColor()}`}
        onClick={handleClick}
        title={`Click to see ${provider} ${category} annotations for line ${rowData.col2}`}
      >
        <div className={`text-xs font-medium ${getTextColor()}`}>
          {trueCount > 0 ? (
            <span title={`${provider} found ${trueCount} features: ${codes.filter(code => rowAnnotations[code]).join(', ')}`}>
              {trueCount}/{totalCount}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </div>
      </td>
    );
  });

  // New CollapsibleFeatureCell component for the new design
  const CollapsibleFeatureCell = React.memo(({ 
    rowData,
    category,
    annotationData,
    onFeatureChange,
    onOpenAnnotationWindow,
    onOpenDefinition
  }: {
    rowData: TableRow;
    category: string;
    annotationData: AnnotationData | null;
    onFeatureChange: (lineNumber: number, code: string, value: boolean) => void;
    onOpenAnnotationWindow: (rowData: TableRow, category: string, codes: string[], rowAnnotations: {[key: string]: boolean}) => void;
    onOpenDefinition: (code: string, definition: string, example1: string, nonexample1: string, position: { x: number; y: number }) => void;
  }) => {
    // Check if row is selectable for annotations
    const isSelectable = isTableRowSelectable(rowData);
    
    // Check if row is selectable for annotations
    const hasAnnotationCategory = !!(annotationData && annotationData[category]);
    
    // CRITICAL FIX: Use parent-level state instead of local state
    const dropdownKey = `${rowData.col2}-${category}`;
    const isExpanded = expandedDropdowns[dropdownKey] || false;
    const dropdownPosition = dropdownPositions[dropdownKey] || 'bottom';

    // Add click-outside-to-close functionality
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (isExpanded) {
          const target = event.target as HTMLElement;
          // Check if the click is outside the dropdown
          if (!target.closest(`[data-dropdown="true"][data-dropdown-key="${dropdownKey}"]`) &&
              !target.closest(`[data-cell-key="${dropdownKey}"]`)) {
            setExpandedDropdowns(prev => ({ ...prev, [dropdownKey]: false }));
          }
        }
      };

      if (isExpanded) {
        document.addEventListener('mousedown', handleClickOutside);
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isExpanded, dropdownKey]);
    
    if (!annotationData?.[category]) {
      return (
        <td className="px-2 py-1 border border-black border-2 text-center">
          <div className="text-xs text-black">—</div>
        </td>
      );
    }

    const rowIndex = rowData.col2 - 1;
    const rowAnnotations = (annotationData[category] && 
                           annotationData[category].annotations && 
                           annotationData[category].annotations[rowIndex]) ? 
                           annotationData[category].annotations[rowIndex] : {};
    const codes = (annotationData[category] && 
                   annotationData[category].codes && 
                   Array.isArray(annotationData[category].codes)) ? 
                   annotationData[category].codes : [];
    
    // Calculate how many features are "Yes" (true)
    const yesCount = codes.filter(code => rowAnnotations[code]).length;
    const totalCount = codes.length;
    


    // Determine background color based on selection state
    const getCellColor = () => {
      if (!isSelectable) return "bg-gray-100";
      // Removed gray-out for non-selectable rows - keep them with normal colors
      
      // HIGHLIGHT: Show yellow if dropdown has ever been opened (stays yellow permanently)
      if (openedDropdowns[dropdownKey]) return "bg-yellow-200";
      
      if (yesCount === 0) return "bg-white";
      if (yesCount === totalCount) return "bg-green-100";
      return "bg-yellow-100"; // Partial selection
    };

    const handleFeatureClick = (code: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const details = (annotationData[category] && 
                       annotationData[category].definitions && 
                       annotationData[category].definitions[code]) ? 
                       annotationData[category].definitions[code] : null;
      if (details) {
        onOpenDefinition(
          code,
          details.Definition || 'No definition available',
          details.example1 || '',
          details.nonexample1 || '',
          {
            x: rect.left + rect.width / 2,
            y: rect.bottom + 10
          }
        );
      }
      // Ensure dropdown stays open
      return false;
    };

    const calculateDropdownPosition = (cellElement: HTMLElement) => {
      const rect = cellElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dropdownHeight = 300; // Estimated dropdown height
      const dropdownWidth = 256; // min-w-64 = 256px

      // Check vertical space
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Check horizontal space
      const spaceRight = viewportWidth - rect.right;
      const spaceLeft = rect.left;

      // Determine best position
      if (spaceBelow >= dropdownHeight) {
        return 'bottom';
      } else if (spaceAbove >= dropdownHeight) {
        return 'top';
      } else if (spaceRight >= dropdownWidth) {
        return 'right';
      } else if (spaceLeft >= dropdownWidth) {
        return 'left';
      } else {
        return 'bottom'; // Default fallback
      }
    };

    const handleCellClick = (event: React.MouseEvent) => {
      if (isSelectable) { // Use only isSelectable check
        event.preventDefault();
        event.stopPropagation();
        
        // Toggle the dropdown - close if already open, open if closed
        if (isExpanded) {
          // Close the dropdown if it's currently open
          setExpandedDropdowns(prev => ({ ...prev, [dropdownKey]: false }));
        } else {
          // Open the dropdown if it's currently closed
          const cellElement = event.currentTarget as HTMLElement;
          const position = calculateDropdownPosition(cellElement);
          setDropdownPositions(prev => ({ ...prev, [dropdownKey]: position }));
          setExpandedDropdowns(prev => ({ ...prev, [dropdownKey]: true }));
          // Mark this dropdown as having been opened at least once
          setOpenedDropdowns(prev => ({ ...prev, [dropdownKey]: true }));
        }
      }
    };

    const handleOpenAnnotationWindowLocal = (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenAnnotationWindow(rowData, category, codes, rowAnnotations);
      setExpandedDropdowns(prev => ({ ...prev, [dropdownKey]: false }));
    };

    const handleCloseDropdown = () => {
      setExpandedDropdowns(prev => ({ ...prev, [dropdownKey]: false }));
    };

    const getDropdownClasses = () => {
      const baseClasses = "absolute bg-white border-2 border-gray-800 rounded-lg shadow-lg z-40 min-w-64 p-3";
      
      switch (dropdownPosition) {
        case 'top':
          return `${baseClasses} bottom-full left-1/2 transform -translate-x-1/2 mb-1`;
        case 'right':
          return `${baseClasses} top-0 left-full ml-1`;
        case 'left':
          return `${baseClasses} top-0 right-full mr-1`;
        case 'bottom':
        default:
          return `${baseClasses} top-full left-1/2 transform -translate-x-1/2 mt-1`;
      }
    };

    return (
      <>
        <td 
          className={`px-2 py-1 border border-black border-2 text-center relative cursor-pointer ${getCellColor()}`}
          onClick={handleCellClick}
          data-cell-key={dropdownKey}
        >
          {isSelectable ? (
            <div className="text-xs font-medium relative">
              {/* Summary display */}
              <div className={yesCount > 0 ? 'text-green-700' : 'text-black'}>
                {yesCount}/{totalCount}
                </div>
              
              {/* Dropdown expansion */}
              {isExpanded && (
                <div 
                  className={getDropdownClasses()}
                  onClick={(e) => e.stopPropagation()}
                  data-dropdown="true"
                  data-dropdown-key={dropdownKey}
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="text-sm font-semibold text-gray-800">
                      {category} Features
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleOpenAnnotationWindowLocal}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                        title="Open full annotation window"
                      >
                        ⤢
                      </button>
                      <button
                        onClick={handleCloseDropdown}
                        className="text-gray-500 hover:text-gray-700 text-lg leading-none"
                        title="Close"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {codes && Array.isArray(codes) ? codes.map((code: string) => (
                      <div key={code} className="flex items-center justify-between text-xs cursor-pointer hover:bg-gray-50 p-1 rounded">
                        <div className="flex items-center flex-1">
                          <input
                            type="checkbox"
                            checked={rowAnnotations[code] || false}
                            onChange={(e) => {
                              e.stopPropagation();
                              onFeatureChange(rowData.col2 - 1, code, e.target.checked);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            className="mr-2 form-checkbox h-3 w-3 text-blue-600"
                            disabled={!isSelectable}
                          />
                          <button
                            className="text-sky-600 hover:text-sky-800 hover:underline text-left flex-1"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleFeatureClick(code, e);
                              return false;
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            title="Click for definition and examples"
                          >
                            {code}
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="text-center text-gray-500 py-4">
                        <p>No feature codes available</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-black">—</div>
          )}
        </td>


      </>
    );
  }, (prevProps, nextProps) => {
    // Custom comparison: Only re-render if THIS specific row's annotations change
    const prevRowData = prevProps.rowData;
    const nextRowData = nextProps.rowData;
    
    // Basic props comparison
    if (prevRowData.col2 !== nextRowData.col2 || 
        prevProps.category !== nextProps.category ||
        false) { // No longer need to compare isStudent
      return false; // Re-render if basic props changed
    }
    
    // Check if annotation data for THIS specific row changed
    if (!prevProps.annotationData || !nextProps.annotationData) return false;
    
    const prevCategoryData = prevProps.annotationData[prevProps.category];
    const nextCategoryData = nextProps.annotationData[nextProps.category];
    
    if (!prevCategoryData || !nextCategoryData) return false;
    
    const rowIndex = prevRowData.col2 - 1;
    const prevRowAnnotations = (prevCategoryData.annotations && 
                                prevCategoryData.annotations[rowIndex]) ? 
                                prevCategoryData.annotations[rowIndex] : {};
    const nextRowAnnotations = (nextCategoryData.annotations && 
                                nextCategoryData.annotations[rowIndex]) ? 
                                nextCategoryData.annotations[rowIndex] : {};
    
    // Only re-render if THIS row's annotations changed
    return JSON.stringify(prevRowAnnotations) === JSON.stringify(nextRowAnnotations);
  });


  // Memoize the filtered table data
  const filteredTableData = React.useMemo(() => {
    return tableData.filter(rowData => {
        // Handle speaker filtering
  if (speakerFilter === 'student_only') {
    return rowData.col5.includes('Student');
  } else if (speakerFilter === 'teacher_only') {
    return rowData.col5.includes('Teacher') || (!rowData.col5.includes('Student') && !rowData.col5.includes('teacher'));
  } else if (speakerFilter !== 'full_transcript') {
    // Filter by specific speaker
    return rowData.col5 === speakerFilter;
  }
  
  // Handle segment filter (existing logic)
  if (whichSegment === 'student_only') {
    return rowData.col5.includes('Student');
  }
      // Handle segment-based filtering
      return whichSegment === 'full_transcript' || rowData.col1 === whichSegment;
    });
      }, [tableData, whichSegment, speakerFilter]);

  // Optimize the debounced save to be less aggressive
  const debouncedSave = React.useCallback(
    debounce(async (data: AnnotationData) => {
      await safeStorageSet(`annotations-${number}`, JSON.stringify(data));
    }, 2000), // Increased debounce time to reduce storage operations
    [number]
  );

  // Add new state for learning goal note popup
  const [learningGoalNotePopup, setLearningGoalNotePopup] = useState<{
    rowIndex: number;
    rowData: TableRow;
    position: { x: number; y: number };
    mode: 'initial' | 'creating'; // Add mode to track popup state
  } | null>(null);

  // Add state for new note title during creation
  const [newNoteTitle, setNewNoteTitle] = useState('');

  // Update TableRow component to handle learning goal note cell clicks
  const TableRow = React.memo(({ 
    rowData, 
    rowIndex,
    annotationData,
    separateLlmAnnotationData,
    onFeatureChange,
    speakerColors,
    columnVisibility,
    showNotesColumn,
    isCreatingNote,
    editingLinesId,
    selectedRows,
    tempSelectedRows,
    toggleRowSelection,
    toggleTempRowSelection,
    getNoteDisplayText,
    hasSegmentColumn,
    extraColumns,
    extraColumnVisibility
  }: {
    rowData: TableRow;
    rowIndex: number;
    annotationData: AnnotationData | null;
    separateLlmAnnotationData: {[provider: string]: AnnotationData} | null;
    onFeatureChange: (lineNumber: number, code: string, value: boolean) => void;
    speakerColors: { [key: string]: string };
    columnVisibility: any;
    showNotesColumn: boolean;
    isCreatingNote: boolean;
    editingLinesId: number | null;
    selectedRows: number[];
    tempSelectedRows: number[];
    toggleRowSelection: (col2Value: number) => void;
    toggleTempRowSelection: (col2Value: number) => void;
    getNoteDisplayText: (idsString: string, rowIndex: number) => React.ReactNode;
    hasSegmentColumn: boolean;
    extraColumns: string[];
    extraColumnVisibility: {[key: string]: boolean};
  }) => {
    const hasNote = rowData.noteIds.trim() !== "";
    const isSelectedForLineEdit = editingLinesId !== null && tempSelectedRows.includes(+rowData.col2);
    const isRowSelectableForNote = isTableRowSelectable(rowData);
    const isSelectedForNoteCreation = isCreatingNote && selectedRows.includes(rowData.col2);

    // Search highlighting
    const isSearchMatch = searchMatches.includes(rowIndex);
    const isCurrentMatch = currentSearchMatch >= 0 && searchMatches[currentSearchMatch] === rowIndex;

    const handleLearningGoalNoteCellClick = (e: React.MouseEvent) => {
      if (!isRowSelectableForNote) return;
      
      const rect = e.currentTarget.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const popupHeight = 300; // Approximate max height of popup
      const popupWidth = 250; // minWidth of popup
      
      // Calculate available space in each direction
      const spaceRight = viewportWidth - rect.right;
      const spaceLeft = rect.left;
      
      // Determine position
      let top: number;
      let left: number;
      
      // First try to position to the right of the cell
      if (spaceRight >= popupWidth) {
        left = rect.right;
        top = rect.top;
        
        // If popup would go off the bottom, move it up
        if (top + popupHeight > viewportHeight) {
          top = Math.max(0, viewportHeight - popupHeight);
        }
      }
      // If not enough space on right, try left
      else if (spaceLeft >= popupWidth) {
        left = rect.left - popupWidth;
        top = rect.top;
        
        // If popup would go off the bottom, move it up
        if (top + popupHeight > viewportHeight) {
          top = Math.max(0, viewportHeight - popupHeight);
        }
      }
      // If not enough space on either side, position below
      else {
        left = rect.left;
        if (rect.bottom + popupHeight <= viewportHeight) {
          top = rect.bottom;
        } else {
          top = rect.top - popupHeight;
        }
      }
      
      setLearningGoalNotePopup({
        rowIndex,
        rowData,
        position: {
          x: left,
          y: top
        },
        mode: 'initial'
      });
    };

    return (
      <tr
        data-row-index={rowIndex}
        className={`${speakerColors[rowData.col5] || "bg-gray-100"} 
          ${hasNote ? "font-bold" : ""} 
          ${isSelectedForLineEdit ? "ring-2 ring-blue-500" : ""}
          ${isSelectedForNoteCreation ? "ring-2 ring-green-500" : ""}
          ${isCurrentMatch ? "ring-2 ring-yellow-400 bg-yellow-100" : 
            isSearchMatch ? "bg-yellow-50" : ""}
        `}
      >
        {/* Select column */}
        {(isCreatingNote || editingLinesId !== null) && (
          <td className="w-12 px-2 py-2 border border-black border-2 text-center">
            {isRowSelectableForNote ? (
              isCreatingNote ? (
                <input
                  type="checkbox"
                  checked={selectedRows.includes(rowData.col2)}
                  onChange={() => toggleRowSelection(rowData.col2)}
                  className="form-checkbox h-4 w-4 text-green-500 focus:ring-green-500"
                />
              ) : (
                <input
                  type="checkbox"
                  checked={tempSelectedRows.includes(rowData.col2)}
                  onChange={() => toggleTempRowSelection(rowData.col2)}
                  className="form-checkbox h-4 w-4 text-blue-500 focus:ring-blue-500"
                />
              )
            ) : (
              <span className="text-black text-xs">N/A</span>
            )}
          </td>
        )}

        {/* Standard columns */}
        {hasSegmentColumn && columnVisibility.segment && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-24">
            {rowData.col1}
          </td>
        )}
        {columnVisibility.lineNumber && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-24">
            {rowData.col2}
          </td>
        )}
        {columnVisibility.start && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-24">
            {rowData.col3}
          </td>
        )}
        {columnVisibility.end && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-24">
            {rowData.col4}
          </td>
        )}
        {columnVisibility.speaker && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-32">
            {rowData.col5}
          </td>
        )}
        {columnVisibility.utterance && (
          <td className="px-2 py-1 border border-black border-2 text-sm text-black w-auto overflow-auto whitespace-normal break-words">
            {isSearchMatch && searchTerm && !(/^\d+$/.test(searchTerm.trim())) ? (
              <span dangerouslySetInnerHTML={{
                __html: rowData.col6.replace(
                  new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
                  '<mark class="bg-yellow-300">$1</mark>'
                )
              }} />
            ) : (
              rowData.col6
            )}
          </td>
        )}

        {/* Notes Column */}
        {showNotesColumn && (
          <td 
            className={`px-2 py-1 border border-black border-2 text-sm text-black ${columnVisibility.notes ? 'w-24' : 'w-12'} 
              ${isRowSelectableForNote ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed'} 
              relative group`}
            onClick={handleLearningGoalNoteCellClick}
          >
            {getNoteDisplayText(rowData.noteIds, rowData.col2 - 1)}
            {!isRowSelectableForNote && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-gray-500">Not eligible for notes</span>
              </div>
            )}
          </td>
        )}

        {/* Replace feature columns with the new component */}
        {annotationData && Object.keys(annotationData).map(category => (
          <CollapsibleFeatureCell
            key={category}
            rowData={rowData}
            category={category}
            annotationData={annotationData}
            onFeatureChange={onFeatureChange}
            onOpenAnnotationWindow={handleOpenAnnotationWindow}
            onOpenDefinition={handleOpenDefinition}
          />
        ))}

        {/* LLM Feature Columns */}
        {separateLlmAnnotationData && Object.entries(separateLlmAnnotationData).map(([provider, providerData]) => 
          Object.keys(providerData).map(category => (
            <LLMFeatureCell
              key={`llm-${provider}-${category}`}
              rowData={rowData}
              category={category}
              llmAnnotationData={providerData}
              provider={provider}
              onCellClick={handleLLMCellClick}
            />
          ))
        )}

        {/* Extra Columns */}
        {extraColumns.map(colName => 
          extraColumnVisibility[colName] && (
            <td 
              key={colName}
              className="px-2 py-1 border border-black border-2 text-sm text-black w-24"
            >
              {rowData[colName]}
            </td>
          )
        )}
      </tr>
    );
  }, (prevProps, nextProps) => {
    // Simplified comparison function
    if (!prevProps.annotationData || !nextProps.annotationData) return false;
    
    return (
      prevProps.rowData === nextProps.rowData &&
      prevProps.rowIndex === nextProps.rowIndex &&
      prevProps.annotationData === nextProps.annotationData &&
      prevProps.selectedRows === nextProps.selectedRows &&
      prevProps.tempSelectedRows === nextProps.tempSelectedRows &&
      prevProps.editingLinesId === nextProps.editingLinesId &&
      prevProps.isCreatingNote === nextProps.isCreatingNote &&
      prevProps.hasSegmentColumn === nextProps.hasSegmentColumn &&
      prevProps.extraColumns === nextProps.extraColumns &&
      prevProps.extraColumnVisibility === nextProps.extraColumnVisibility
    );
  });

  // Load data once when page loads
  useEffect(() => {
    // Also load LLM annotations
    const loadInitialData = async () => {
      await reloadAnnotationData();
      await updateFeatureDefinitionsForLLM();
    };
    loadInitialData();
    // Note: loadFeatureCategoriesAndAnnotationData will handle loading saved annotation data properly
  }, [number]);

  // Save annotations when unmounting the component
  useEffect(() => {
    return () => {
      const saveOnUnmount = async () => {
        await saveAllAnnotations(annotationData);
      };
      saveOnUnmount();
    };
  }, [annotationData]);

  // Add this useEffect to load annotation data when needed
  useEffect(() => {
    const loadFeatureCategoriesAndAnnotationData = async () => {
      try {
        // Load feature definitions from localStorage
        console.log('Loading feature categories from localStorage...');
        const featureDefinitionsData = await safeStorageGet('feature-definitions');
        
        if (featureDefinitionsData) {
          const featureDefinitions = JSON.parse(featureDefinitionsData);
          console.log('Parsed feature definitions:', featureDefinitions);
          console.log('Feature definitions structure:', Object.keys(featureDefinitions));
          
          if (featureDefinitions.categories && featureDefinitions.categories.length > 0) {
            ALLOWED_SHEETS = featureDefinitions.categories;
            console.log('Loaded feature categories from localStorage:', ALLOWED_SHEETS);
            console.log('Setting ALLOWED_SHEETS to:', featureDefinitions.categories);
            
            // CRITICAL FIX: Ensure tableData is available before proceeding
            if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
              console.warn('Table data not available yet, skipping annotation data loading');
              return;
            }
            
            // Check if annotation data already exists for this transcript
            const existingAnnotationData = await safeStorageGet(`annotations-${number}`);
            let newData = {};
            let hasExistingData = false;
            let shouldSave = false;
            
            if (existingAnnotationData) {
              try {
                const parsedData = JSON.parse(existingAnnotationData);
                // Restore optimized annotation data if needed
                const restoredData = restoreAnnotationData(parsedData, tableData.length);
                // Validate the data structure to prevent array access errors
                const isValidData = Object.keys(restoredData).some(key => {
                  if (key === 'lastSaved' || key === 'lastActivity') return false; // Skip metadata
                  const categoryData = restoredData[key];
                  return categoryData && 
                         typeof categoryData === 'object' && 
                         Array.isArray((categoryData as { codes?: unknown[] }).codes) && 
                         typeof (categoryData as { annotations?: unknown }).annotations === 'object';
                });
                
                if (isValidData) {
                  newData = restoredData;
                  hasExistingData = true;
                  console.log('Found and validated existing annotation data for transcript:', number);
                  
                  // Check if this data was modified by user - if so, preserve it more carefully
                  const wasUserModified = parsedData.lastModifiedBy === 'user';
                  console.log('Data was user modified:', wasUserModified);
                  
                  // Check if existing data matches current codebook structure
                  const needsRegeneration = featureDefinitions.categories.some((category: string) => {
                    const categoryFeatures = featureDefinitions.features?.[category];
                    if (!categoryFeatures || !Array.isArray(categoryFeatures)) return false;
                    
                    const expectedCodes = categoryFeatures.map((feature: any) => feature?.Code).filter(Boolean);
                    const existingCodes = (newData as any)[category]?.codes || [];
                    
                    // Check if codes match
                    return expectedCodes.length !== existingCodes.length || 
                           !expectedCodes.every((code: string) => existingCodes.includes(code));
                  });
                  
                  // CRITICAL FIX: Also check if annotations array length matches current table data
                  const needsRowCountUpdate = featureDefinitions.categories.some((category: string) => {
                    const categoryData = (newData as any)[category];
                    if (!categoryData || !categoryData.annotations) return true;
                    
                    const annotationRowCount = Object.keys(categoryData.annotations).length;
                    return annotationRowCount !== tableData.length;
                  });
                  
                  if (needsRegeneration || needsRowCountUpdate) {
                    if (wasUserModified) {
                      console.log('Codebook has changed or row count mismatch, but preserving user annotations while updating structure...');
                    } else {
                      console.log('Codebook has changed or row count mismatch, will update annotation structure...');
                    }
                    shouldSave = true;
                  }
                } else {
                  console.warn('Invalid annotation data structure, will regenerate');
                  hasExistingData = false;
                  shouldSave = true;
                }
              } catch (error) {
                console.log('Error parsing existing annotation data, will regenerate...');
                hasExistingData = false;
                shouldSave = true;
              }
            } else {
              console.log('No existing annotation data found, generating from codebook...');
              shouldSave = true;
            }
            
            // Generate or update annotation data from feature definitions
            featureDefinitions.categories.forEach((category: string) => {
              const categoryFeatures = featureDefinitions.features?.[category];
              if (!categoryFeatures || !Array.isArray(categoryFeatures)) {
                console.warn(`No features found for category: ${category}`);
                return;
              }
              
              const codes = (categoryFeatures && Array.isArray(categoryFeatures)) ? 
                categoryFeatures.map((feature: any) => feature?.Code).filter(Boolean) : [];
              const definitions: { [key: string]: any } = {};
              
              if (categoryFeatures && Array.isArray(categoryFeatures)) {
              categoryFeatures.forEach((feature: any) => {
                  if (feature?.Code) {
                definitions[feature.Code] = {
                  Definition: feature.Definition || '',
                  example1: feature.Example1 || '',
                  example2: feature.Example2 || '',
                  nonexample1: feature.NonExample1 || '',
                  nonexample2: feature.NonExample2 || ''
                };
                  }
              });
              }
              
              // CRITICAL FIX: Always ensure annotations exist for all rows, regardless of hasSelectableColumn
              if (!hasExistingData || !(newData as any)[category] || !(newData as any)[category]?.codes || (newData as any)[category].codes.length === 0 || shouldSave) {
                console.log('Creating/updating annotation data for:', category, 'with', tableData.length, 'rows');
                const annotations: { [key: number]: { [code: string]: boolean } } = {};
                
                // Initialize annotations for ALL rows - this fixes the missing Selectable column issue
                for (let i = 0; i < tableData.length; i++) {
                  annotations[i] = {};
                  codes.forEach((code: string) => {
                      if (code) {
                    annotations[i][code] = false;
                      }
                  });
                }
                
                // If we had existing data and want to preserve annotations, merge them
                if (hasExistingData && (newData as any)[category]?.annotations) {
                  const existingAnnotations = (newData as any)[category].annotations;
                  for (let i = 0; i < tableData.length; i++) {
                    if (existingAnnotations[i]) {
                      codes.forEach((code: string) => {
                        if (code && existingAnnotations[i][code] !== undefined) {
                          annotations[i][code] = existingAnnotations[i][code];
                        }
                      });
                    }
                  }
                }
                
                (newData as any)[category] = {
                  codes,
                  definitions,
                  annotations
                };
              } else {
                // Update codes and definitions while preserving existing annotations
                const existingAnnotations = (newData as any)[category]?.annotations || {};
                
                // Ensure all lines have annotations for all codes
                const updatedAnnotations: { [key: number]: { [code: string]: boolean } } = {};
                for (let i = 0; i < tableData.length; i++) {
                  updatedAnnotations[i] = existingAnnotations[i] || {};
                  codes.forEach((code: string) => {
                      if (code && !(code in updatedAnnotations[i])) {
                      updatedAnnotations[i][code] = false;
                    }
                  });
                }
                
                (newData as any)[category] = {
                  codes,
                  definitions,
                  annotations: updatedAnnotations
                };
              }
            });
            
            console.log('Setting annotation data:', newData);
            setAnnotationData(newData as AnnotationData);
            
            // Only save if there were changes or no existing data
            if (shouldSave) {
              console.log('Saving updated annotation data to localStorage');
              await safeStorageSet(`annotations-${number}`, JSON.stringify(newData));
            } else {
              console.log('No changes needed, preserving existing annotation data');
            }
          } else {
            // Check if it's the new direct format (category names as keys)
            const isDirectFormat = typeof featureDefinitions === 'object' && 
                                  featureDefinitions !== null && 
                                  !featureDefinitions.categories && 
                                  !featureDefinitions.features &&
                                  Object.keys(featureDefinitions).length > 0;
            console.log('Direct format check:', isDirectFormat);
            
            if (isDirectFormat) {
              // Direct format: { "Conceptual": [...], "Discursive": [...] }
              const categories = Object.keys(featureDefinitions);
              ALLOWED_SHEETS = categories;
              console.log('Loaded categories from localStorage (direct format):', ALLOWED_SHEETS);
              
              // CRITICAL FIX: Ensure tableData is available before proceeding
              if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
                console.warn('Table data not available yet, skipping annotation data loading');
                return;
              }
              
              // Check if annotation data already exists for this transcript
              const existingAnnotationData = await safeStorageGet(`annotations-${number}`);
              let newData = {};
              let hasExistingData = false;
              let shouldSave = false;
              
              if (existingAnnotationData) {
                try {
                  const parsedData = JSON.parse(existingAnnotationData);
                  // Validate the data structure to prevent array access errors
                  const isValidData = Object.keys(parsedData).some(key => {
                    if (key === 'lastSaved' || key === 'lastActivity') return false; // Skip metadata
                    const categoryData = parsedData[key];
                    return categoryData && 
                           typeof categoryData === 'object' && 
                           Array.isArray(categoryData.codes) && 
                           typeof categoryData.annotations === 'object';
                  });
                  
                  if (isValidData) {
                    newData = parsedData;
                    hasExistingData = true;
                    console.log('Found and validated existing annotation data for transcript (direct format):', number);
                    
                    // CRITICAL FIX: Check if annotations array length matches current table data
                    const needsRowCountUpdate = categories.some((category: string) => {
                      const categoryData = (newData as any)[category];
                      if (!categoryData || !categoryData.annotations) return true;
                      
                      const annotationRowCount = Object.keys(categoryData.annotations).length;
                      return annotationRowCount !== tableData.length;
                    });
                    
                    if (needsRowCountUpdate) {
                      console.log('Row count mismatch detected, will update annotation structure...');
                      shouldSave = true;
                    }
                  } else {
                    console.warn('Invalid annotation data structure, will regenerate');
                    hasExistingData = false;
                    shouldSave = true;
                  }
                } catch (error) {
                  console.log('Error parsing existing annotation data, will regenerate...');
                  hasExistingData = false;
                  shouldSave = true;
                }
              } else {
                console.log('No existing annotation data found, generating from codebook...');
                shouldSave = true;
              }
              
              // Generate annotation data from direct format
              categories.forEach(category => {
                const categoryFeatures = featureDefinitions[category];
                if (!Array.isArray(categoryFeatures)) {
                  console.warn(`Category ${category} does not contain an array of features`);
                  return;
                }
                
                const codes = categoryFeatures.map((feature: any) => feature?.Code).filter(Boolean);
                const definitions: { [key: string]: any } = {};
                
                categoryFeatures.forEach((feature: any) => {
                  if (feature?.Code) {
                    definitions[feature.Code] = {
                      Definition: feature.Definition || '',
                      example1: feature.Example1 || feature.example1 || '',
                      example2: feature.Example2 || feature.example2 || '',
                      nonexample1: feature.NonExample1 || feature.nonexample1 || '',
                      nonexample2: feature.NonExample2 || feature.nonexample2 || ''
                    };
                  }
                });
                
                // CRITICAL FIX: Always ensure annotations exist for all rows
                if (!hasExistingData || !(newData as any)[category] || shouldSave) {
                  console.log('Creating/updating annotation data for:', category, 'with', tableData.length, 'rows (direct format)');
                  const annotations: { [key: number]: { [code: string]: boolean } } = {};
                  
                  // Initialize annotations for ALL rows
                  for (let i = 0; i < tableData.length; i++) {
                    annotations[i] = {};
                    codes.forEach((code: string) => {
                      if (code) {
                        annotations[i][code] = false;
                      }
                    });
                  }
                  
                  // If we had existing data and want to preserve annotations, merge them
                  if (hasExistingData && (newData as any)[category]?.annotations) {
                    const existingAnnotations = (newData as any)[category].annotations;
                    for (let i = 0; i < tableData.length; i++) {
                      if (existingAnnotations[i]) {
                        codes.forEach((code: string) => {
                          if (code && existingAnnotations[i][code] !== undefined) {
                            annotations[i][code] = existingAnnotations[i][code];
                          }
                        });
                      }
                    }
                  }
                  
                  (newData as any)[category] = {
                    codes,
                    definitions,
                    annotations
                  };
                } else {
                  // Update codes and definitions while preserving existing annotations
                  const existingAnnotations = (newData as any)[category]?.annotations || {};
                  
                  // Ensure all lines have annotations for all codes
                  const updatedAnnotations: { [key: number]: { [code: string]: boolean } } = {};
                  for (let i = 0; i < tableData.length; i++) {
                    updatedAnnotations[i] = existingAnnotations[i] || {};
                    codes.forEach((code: string) => {
                      if (code && !(code in updatedAnnotations[i])) {
                        updatedAnnotations[i][code] = false;
                      }
                    });
                  }
                  
                  (newData as any)[category] = {
                    codes,
                    definitions,
                    annotations: updatedAnnotations
                  };
                }
              });
              
              console.log('Setting annotation data (direct format):', newData);
              setAnnotationData(newData as AnnotationData);
              
              // Only save if there were changes or no existing data
              if (shouldSave) {
                console.log('Saving updated annotation data to localStorage (direct format)');
                await safeStorageSet(`annotations-${number}`, JSON.stringify(newData));
              } else {
                console.log('No changes needed, preserving existing annotation data (direct format)');
              }
            } else {
              console.log('No feature categories found in feature definitions');
              setAnnotationData(null);
            }
          }
        } else {
          console.log('No feature definitions found in localStorage');
          setAnnotationData(null);
        }
        
        setLastFeatureDefinitionCheck(Date.now());
      } catch (error) {
        console.error('Error loading annotation data from localStorage:', error);
      }
    };
    
    // Load annotation data when component mounts or tableData changes or when forced to reload
    if (tableData && Array.isArray(tableData) && tableData.length > 0) {
      loadFeatureCategoriesAndAnnotationData();
    }
  }, [tableData.length, forceReloadAnnotations]);



  // Function to parse XLSX annotation data (extracted from existing logic)
  const parseXLSXAnnotationData = (arrayBuffer: ArrayBuffer, existingData: AnnotationData): AnnotationData => {
    const workbook = read(arrayBuffer);
    console.log('Excel file loaded. Sheet names:', workbook.SheetNames);
    console.log('Allowed sheets:', ALLOWED_SHEETS);
    
    const newData = { ...existingData };
    
    // Process all sheets in the workbook
    workbook.SheetNames.forEach(sheetName => {
        console.log('Processing sheet:', sheetName);
        const sheet = workbook.Sheets[sheetName];
        const jsonData = utils.sheet_to_json(sheet);
        
        console.log(`Sheet ${sheetName} data:`, jsonData.slice(0, 3));
        
        // Extract codes and definitions
        const codes = (jsonData as {Code?: string}[])
          .map(row => row.Code)
          .filter((code): code is string => Boolean(code));
        
        console.log(`Codes found in ${sheetName}:`, codes);
        
        const definitions: { [code: string]: FeatureDetails } = {};
        
        (jsonData as {
          Code?: string;
          Definition?: string;
          definition?: string;
          Example1?: string;
          example1?: string;
          Example2?: string;
          example2?: string;
          NonExample1?: string;
          nonexample1?: string;
          NonExample2?: string;
          nonexample2?: string;
        }[]).forEach(row => {
          const definition = row.Definition || row.definition;
          if (row.Code && definition) {
            definitions[row.Code] = {
              Definition: definition,
              example1: row.Example1 || row.example1 || '',
              example2: row.Example2 || row.example2 || '',
              nonexample1: row.NonExample1 || row.nonexample1 || '',
              nonexample2: row.NonExample2 || row.nonexample2 || ''
            };
          }
        });
        
        // Initialize annotations only if they don't exist for this sheet
        if (!newData[sheetName] || newData[sheetName].codes.length === 0) {
          console.log('Creating new annotation data for:', sheetName);
          const annotations: {
            [key: number]: {
              [code: string]: boolean;
            };
          } = {};
          
          for (let i = 0; i < tableData.length; i++) {
            annotations[i] = {};
            codes.forEach(code => {
              annotations[i][code] = false;
            });
          }
          
          newData[sheetName] = {
            codes,
            definitions,
            annotations
          };
        } else {
          // Update codes and definitions while preserving existing annotations
          newData[sheetName] = {
            ...newData[sheetName],
            codes,
            definitions
          };
        }
    });
    
    return newData;
  };

  const handleSaveAnnotations = async (data: AnnotationData) => {
    setAnnotationData(data);
    const optimizedAnnotations = optimizeAnnotationData(data);
    await safeStorageSet(`annotations-${number}`, JSON.stringify(optimizedAnnotations));
    alert('Annotations saved successfully!');
  };

  const handleAnnotationChange = (data: AnnotationData) => {
    // Validate the data structure before setting it
    if (!data || typeof data !== 'object') {
      console.error('Invalid annotation data provided:', data);
      return;
    }
    
    setAnnotationData(data);
  };

  // Function to reload annotation data when feature definitions are updated
  const reloadAnnotationData = async () => {
    setForceReloadAnnotations(prev => prev + 1);
    
    // Load separate LLM annotations for all providers
    const llmAnnotationKey = `llm-annotations-${number}`;
    const storedLlmAnnotations = await safeStorageGet(llmAnnotationKey);
    if (storedLlmAnnotations) {
      try {
        const parsedLlmAnnotations = JSON.parse(storedLlmAnnotations);
        // Check if it's the old format (single provider) and convert it
        if (parsedLlmAnnotations && typeof parsedLlmAnnotations === 'object' && parsedLlmAnnotations.codes) {
          // Old format - convert to new format
          const convertedData = { 'Unknown': parsedLlmAnnotations };
          setSeparateLlmAnnotationData(convertedData);
          await safeStorageSet(llmAnnotationKey, JSON.stringify(convertedData));
        } else {
          // New format - use as is
          setSeparateLlmAnnotationData(parsedLlmAnnotations);
        }
      } catch (error) {
        console.error('Error parsing LLM annotations:', error);
        setSeparateLlmAnnotationData(null);
      }
    } else {
      setSeparateLlmAnnotationData(null);
    }
  };

  // Periodically check for feature definition updates
  useEffect(() => {
    const checkForFeatureDefinitionUpdates = async () => {
      try {
        const response = await fetch('/feature-definitions.json');
        if (response.ok) {
          const data = await response.json();
          const uploadTime = new Date(data.uploadedAt).getTime();
          
          if (uploadTime > lastFeatureDefinitionCheck) {
            console.log('Feature definitions have been updated, reloading...');
            await reloadAnnotationData();
          }
        }
      } catch (error) {
        // Silently ignore errors - feature-definitions.json might not exist
      }
    };

    // Check every 5 seconds for updates
    const interval = setInterval(checkForFeatureDefinitionUpdates, 5000);
    
    return () => clearInterval(interval);
  }, [lastFeatureDefinitionCheck]);

  // Update the state interface to include examples and non-examples
  const [selectedFeaturePopup, setSelectedFeaturePopup] = useState<{
    code: string;
    definition: string;
    example1: string;
    nonexample1: string;
    position: { x: number; y: number };
  } | null>(null);

  // const handleFeatureHeaderClick = (code: string, event: React.MouseEvent) => {
  //   event.preventDefault();
  //   const rect = (event.target as HTMLElement).getBoundingClientRect();
  //   const details = getFeatureDetails(code);
  //   setSelectedFeaturePopup({
  //     code,
  //     definition: details?.Definition || 'No definition available',
  //     example1: details?.example1 || '',
  //     nonexample1: details?.nonexample1 || '',
  //     position: {
  //       x: rect.left + rect.width / 2,
  //       y: rect.bottom + 10
  //     }
  //   });
  // };

  useEffect(() => {
    const initializeTranscript = async () => {
      const fetchContent = async () => {
        try {
        // First try to load from API (public folder)
        try {
          const response = await fetch(`/api/transcript/t${number}?file=content.json`);
          if (response.ok) {
            const data = await response.json();
            setTitle(data.title || data.gradeLevel || "");
            setInstruction(data.instruction || data.lessonGoal || "");
            setAvailableSegment(data.segments || []);
            console.log('Loaded content from public folder:', data);
            return;
          }
        } catch (apiError) {
          console.log('Content not found in public folder, trying localStorage');
        }
        
        // Fallback to localStorage
        const contentData = await safeStorageGet(`t${number}-content.json`);
        if (contentData) {
          const data = JSON.parse(contentData);
          setTitle(data.title || data.gradeLevel || "");
          setInstruction(data.instruction || data.lessonGoal || "");
          setAvailableSegment(data.segments || []);
          console.log('Loaded content from localStorage:', data);
        } else {
          // Default values if no content found anywhere
          setTitle("Title");
          setInstruction("Instruction");
          setAvailableSegment([]);
          console.log('No content found anywhere, using defaults');
        }
      } catch (err) {
        console.error("Error loading content:", err);
        // Set defaults on error
        setTitle("Title");
        setInstruction("Instruction");
        setAvailableSegment([]);
      }
    };

    const fetchSpeakers = async () => {
      try {
        // First try to load from API (public folder)
        try {
          const response = await fetch(`/api/transcript/t${number}?file=speakers.json`);
          if (response.ok) {
            const data = await response.json();
            setSpeakerColors(data);
            console.log('Loaded speakers from public folder:', data);
            return;
          }
        } catch (apiError) {
          console.log('Speakers not found in public folder, trying localStorage');
        }
        
        // Fallback to localStorage
        const speakersData = await safeStorageGet(`t${number}-speakers.json`);
        if (speakersData) {
          const data = JSON.parse(speakersData);
          setSpeakerColors(data);
          console.log('Loaded speakers from localStorage:', data);
        } else {
          // Default speaker colors if no data found anywhere
          setSpeakerColors({});
          console.log('No speakers found anywhere, using empty object');
        }
      } catch (err) {
        console.error("Error loading speakers:", err);
        setSpeakerColors({});
      }
    };
    
    const loadCSVData = async () => {
      try {
        let csvData = null;
        
        // First try to load from API (public folder)
        try {
          const response = await fetch(`/api/transcript/t${number}?file=transcript.csv`);
          if (response.ok) {
            csvData = await response.text();
            console.log("Loaded CSV content from public folder: ", csvData.substring(0, 500));
          }
        } catch (apiError) {
          console.log('CSV not found in public folder, trying localStorage');
        }
        
        // Fallback to localStorage if API failed
        if (!csvData) {
          csvData = await loadTranscriptData(`t${number}`);
          if (csvData) {
            console.log("Loaded CSV content from localStorage: ", csvData.substring(0, 500));
          }
        }
        
        if (csvData) {
          Papa.parse(csvData, {
            complete: async (result) => {
              console.log("CSV Data Loaded: ", result);
              if (result.errors.length) {
                setError("Error in CSV parsing: " + result.errors.map((err) => err.message).join(", "));
                setLoading(false);
                return;
              }
              
              // Get headers and dynamically find the right columns
              const headers = Object.keys((result.data as CsvRow[])[0] || {});
              
              // Find the line number column (could be "#", "Line #", "Line Number", etc.)
              const lineNumberCol = headers.find(h => h.toLowerCase().includes("#") || h.toLowerCase().includes("line")) || "#";
              
              // Find the speaker column
              const speakerCol = headers.find(h => h.toLowerCase().includes("speaker")) || "Speaker";
              
              // Find the dialogue/utterance column
              const dialogueCol = headers.find(h => h.toLowerCase().includes("dialogue") || h.toLowerCase().includes("utterance")) || "Dialogue";
              
              // Find timing columns
              const startCol = headers.find(h => h.toLowerCase().includes("in") || h.toLowerCase().includes("start")) || "In cue";
              const endCol = headers.find(h => h.toLowerCase().includes("out") || h.toLowerCase().includes("end")) || "Out cue";
              
              // Find segment column if it exists
              const segmentCol = headers.find(h => h.toLowerCase() === "segment");
              const hasSegment = !!segmentCol;
              setHasSegmentColumn(hasSegment);
              
              // Find selectable column if it exists
              const selectableCol = headers.find(h => h.toLowerCase().includes("selectable"));
              const hasSelectableCol = !!selectableCol;
              setHasSelectableColumn(hasSelectableCol);
              
              // Ensure segment column is visible if it exists
              if (hasSegment) {
                setColumnVisibility(prev => ({
                  ...prev,
                  segment: true
                }));
              }
              
              // All other columns are considered extra
              const coreColumns = [lineNumberCol, startCol, endCol, speakerCol, dialogueCol];
              if (segmentCol) coreColumns.push(segmentCol);
              if (selectableCol) coreColumns.push(selectableCol);
              const extraCols = filterMetadataColumns(headers.filter(header => 
                !coreColumns.includes(header)
              ));
              
              // Setup extra columns
              setExtraColumns(extraCols);
              const initialExtraVisibility: {[key: string]: boolean} = {};
              extraCols.forEach(col => {
                initialExtraVisibility[col] = false; // Hidden by default
              });
              setExtraColumnVisibility(initialExtraVisibility);
              
              // Add the type assertion here with updated schema
              const updatedData = (result.data as CsvRow[]).map((row, index) => {
                const baseData: TableRow = {
                  col1: hasSegment ? (row[segmentCol!] || null) : null,
                  col2: parseInt(row[lineNumberCol] || "", 10) || index + 1,
                  col3: row[startCol] || "",
                  col4: row[endCol] || "",
                  col5: row[speakerCol] || "",
                  col6: row[dialogueCol] || "",
                  col7: selectableCol ? (row[selectableCol] || "") : "", // Use selectable column if it exists
                  noteIds: "",
                };
                
                // Add extra columns
                extraCols.forEach(col => {
                  baseData[col] = row[col] || "";
                });
                
                return baseData;
              });

              console.log("Setting table data:", updatedData.length, "rows");
              console.log("Sample table data structure:", updatedData.slice(0, 2));
              
              // Check if the loaded CSV contains actual content
              const hasRealContent = updatedData.some(row => 
                (row.col5 && row.col5.trim() !== "") || (row.col6 && row.col6.trim() !== "")
              );
              
              if (hasRealContent) {
                setTableData(updatedData);
                setExtraColumns(extraCols);
                setExtraColumnVisibility(initialExtraVisibility);
                setDataLoaded(true); // Mark that real data has been loaded
                console.log("Table data state updated successfully with real content");
              } else {
                console.warn("CSV data appears to be empty, not updating table data");
                setError("Transcript data appears to be empty. Please check the CSV file.");
                setLoading(false);
                return;
              }

              // Save table data and metadata including hasSelectableColumn flag (only if we have real content)
              const dataToSave = {
                tableData: updatedData,
                notes: [],
                nextNoteId: 1,
                hasSegmentColumn: hasSegment,
                hasSelectableColumn: hasSelectableCol, // CRITICAL FIX: Store this flag
                extraColumns: extraCols,
                extraColumnVisibility: initialExtraVisibility
              };
              
              try {
                await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
                console.log('Successfully saved transcript data to localStorage');
              } catch (error) {
                console.error('Failed to save transcript data to localStorage (likely due to size limits):', error);
                setStorageWarning("Unable to save transcript data locally due to size limits. Data will not persist between sessions.");
                // Continue loading even if save fails - the transcript is still usable for the current session
              }

              console.log("About to set loading to false");
              setLoading(false);
              console.log("Loading set to false - transcript should render now");
            },
            header: true,
            skipEmptyLines: true,
          });
        } else {
          setError("No transcript data found. Please upload a transcript first.");
          setLoading(false);
        }
      } catch (error) {
        if (error instanceof Error) {
          setError("Error loading CSV data: " + error.message);
        } else {
          setError("An unknown error occurred while loading CSV data.");
        }
        setLoading(false);
      }
    };
    
    // EMERGENCY CLEANUP: Force remove metadata columns from localStorage RIGHT NOW
    const emergencyCleanup = async () => {
      try {
        const currentData = await safeStorageGet(`tableData-${number}`);
        if (currentData) {
          const parsed = JSON.parse(currentData);
          if (parsed.tableData && Array.isArray(parsed.tableData)) {
            const ultraCleanedData = parsed.tableData.map((row: any) => {
              const cleanRow = { ...row };
              delete cleanRow.lastSaved;
              delete cleanRow.lastActivity;
              delete cleanRow.lastModifiedBy;
              return cleanRow;
            });
            
            const cleanedData = {
              ...parsed,
              tableData: ultraCleanedData
            };
            
            await safeStorageSet(`tableData-${number}`, JSON.stringify(cleanedData));
            console.log('EMERGENCY CLEANUP COMPLETED - Metadata columns removed');
          }
        }
      } catch (error) {
        console.error('Emergency cleanup failed:', error);
      }
    };
    
    // Run emergency cleanup first
    await emergencyCleanup();
    
    // Check localStorage first
    const savedData = await safeStorageGet(`tableData-${number}`);
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        setAvailableIds(parsedData.availableIds || []);
        // Handle migration from old format to new format  
        if (parsedData.tableData && parsedData.tableData.length > 0) {
          // Migrate old noteTitle format to new noteIds format
          if (parsedData.tableData[0]?.noteTitle !== undefined && parsedData.tableData[0]?.noteIds === undefined) {
            // Create a mapping of old titles to new IDs
            const titleToIdMap = new Map<string, number>();
            let highestId = 0;
            
            const migratedNotes: Note[] = [];
            parsedData.tableData.forEach((row: any, rowIndex: number) => {
              const oldTitles = row.noteTitle ? row.noteTitle.split(',').map((t: string) => t.trim()).filter((t: string) => t !== "") : [];
              
              oldTitles.forEach((oldTitle: string) => {
                if (!titleToIdMap.has(oldTitle)) {
                  // Create a new ID for this title
                  const newId = highestId + 1;
                  highestId = newId;
                  titleToIdMap.set(oldTitle, newId);
                  
                  const oldNote = parsedData.notes?.find((n: any) => n.title === oldTitle);
                  
                  migratedNotes.push({
                    id: newId,
                    title: oldTitle,
                    content_1: oldNote?.content_1 || "",
                    content_2: oldNote?.content_2 || "",
                    rowIndices: [rowIndex],
                    lineNumbers: [parsedData.tableData[rowIndex]?.col2 || rowIndex + 1]
                  });
                } else {
                  // Add this row to the existing note
                  const existingNoteId = titleToIdMap.get(oldTitle);
                  const existingNote = migratedNotes.find(n => n.id === existingNoteId);
                  if (existingNote && !existingNote.rowIndices.includes(rowIndex)) {
                    existingNote.rowIndices.push(rowIndex);
                    const lineNumber = parsedData.tableData[rowIndex]?.col2 || rowIndex + 1;
                    if (!existingNote.lineNumbers.includes(lineNumber)) {
                      existingNote.lineNumbers.push(lineNumber);
                    }
                  }
                }
              });
            });
            
            const migratedTableData = parsedData.tableData.map((row: any) => {
              const oldTitles = row.noteTitle ? row.noteTitle.split(',').map((t: string) => t.trim()).filter((t: string) => t !== "") : [];
              const newIds = oldTitles.map((title: string) => titleToIdMap.get(title)).filter(Boolean);
              
              // Filter out unwanted metadata columns from the row
              const filteredRow = cleanTableRow(row);
              
              return {
                ...filteredRow,
                noteIds: newIds.join(', '),
              };
            });
            
            // AGGRESSIVE CLEANUP: Save cleaned data back to localStorage immediately
            const aggressivelyCleanedData = {
              ...parsedData,
              tableData: migratedTableData,
              notes: migratedNotes,
              nextNoteId: highestId + 1
            };
            try {
              await safeStorageSet(`tableData-${number}`, JSON.stringify(aggressivelyCleanedData));
            } catch (error) {
              console.warn('Failed to save migrated data to localStorage (likely due to size limits):', error);
            }
            
            setTableData(migratedTableData);
            setNotes(migratedNotes);
            setNextNoteId(highestId + 1);
            setDataLoaded(true); // Mark that real data has been loaded from localStorage
            
            // Set up extra columns from migrated data, excluding unwanted metadata columns
            if (migratedTableData.length > 0) {
              const firstRow = migratedTableData[0];
              const allColumns = Object.keys(firstRow);
              const coreColumns = ['col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7', 'noteIds'];
              const extraCols = filterMetadataColumns(allColumns.filter(col => 
                !coreColumns.includes(col)
              ));
              
              setExtraColumns(extraCols);
              const initialExtraVisibility: {[key: string]: boolean} = {};
              extraCols.forEach(col => {
                initialExtraVisibility[col] = false; // Hidden by default
              });
              setExtraColumnVisibility(initialExtraVisibility);
            }
          } else {
            // If data is already in the new format
            // Filter out unwanted metadata columns from existing data
            const cleanedTableData = parsedData.tableData.map(cleanTableRow);
            
            // AGGRESSIVE CLEANUP: Remove metadata columns from localStorage immediately
            const aggressivelyCleanedData = {
              ...parsedData,
              tableData: cleanedTableData
            };
            try {
              await safeStorageSet(`tableData-${number}`, JSON.stringify(aggressivelyCleanedData));
            } catch (error) {
              console.warn('Failed to save cleaned data to localStorage (likely due to size limits):', error);
            }
            
            setTableData(cleanedTableData);
            setDataLoaded(true); // Mark that real data has been loaded from localStorage
            
            // Set up extra columns from saved data or derive from cleaned data
            if (parsedData.extraColumns && parsedData.extraColumnVisibility) {
              setExtraColumns(parsedData.extraColumns);
              setExtraColumnVisibility(parsedData.extraColumnVisibility);
            } else if (cleanedTableData.length > 0) {
              // Fallback for older data without metadata
              const firstRow = cleanedTableData[0];
              const allColumns = Object.keys(firstRow);
              const coreColumns = ['col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7', 'noteIds'];
              const extraCols = filterMetadataColumns(allColumns.filter(col => 
                !coreColumns.includes(col)
              ));
              
              setExtraColumns(extraCols);
              const initialExtraVisibility: {[key: string]: boolean} = {};
              extraCols.forEach(col => {
                initialExtraVisibility[col] = false; // Hidden by default
              });
              setExtraColumnVisibility(initialExtraVisibility);
            }
            
            // Ensure all notes have lineNumbers field
            const notesWithLineNumbers = (parsedData.notes || []).map((note: any) => ({
              ...note,
              lineNumbers: note.lineNumbers || note.rowIndices.map((index: number) => 
                parsedData.tableData[index]?.col2 || index + 1
              )
            }));
            
            setNotes(notesWithLineNumbers);
            setNextNoteId(parsedData.nextNoteId || Math.max(...parsedData.notes.map((n: Note) => n.id), 0) + 1);
          }
          
          // Check if the loaded data has segment column and ensure it's visible
          if (parsedData.tableData && parsedData.tableData.length > 0) {
            // Load hasSegmentColumn from saved data or fallback to detection
            const hasSegment = parsedData.hasSegmentColumn ?? 
              (parsedData.tableData[0].col1 !== null && parsedData.tableData[0].col1 !== undefined);
            setHasSegmentColumn(hasSegment);
            if (hasSegment) {
              setColumnVisibility(prev => ({
                ...prev,
                segment: true
              }));
            }
            
            // CRITICAL FIX: Use stored hasSelectableColumn flag, but intelligently fallback for backwards compatibility
            let hasSelectableCol: boolean;
            if (parsedData.hasSelectableColumn !== undefined) {
              // Use the stored flag if it exists (new data)
              hasSelectableCol = parsedData.hasSelectableColumn;
            } else {
              // For backwards compatibility: check ALL columns for meaningful selectable data
              // Selectable columns can be anywhere: col7, extraColumns, etc.
              const allSelectableValues: string[] = [];
              
              // Check col7 (primary location for selectable data)
              const col7Values = parsedData.tableData.map((row: any) => row.col7?.toLowerCase?.()?.trim()).filter(Boolean);
              allSelectableValues.push(...col7Values);
              
              // Check extra columns for any that might contain selectable data
              if (parsedData.extraColumns && parsedData.tableData.length > 0) {
                parsedData.extraColumns.forEach((colName: string) => {
                  if (colName.toLowerCase().includes('selectable')) {
                    const colValues = parsedData.tableData.map((row: any) => row[colName]?.toLowerCase?.()?.trim()).filter(Boolean);
                    allSelectableValues.push(...colValues);
                  }
                });
              }
              
              // Also check all row properties for any selectable-named columns
              if (parsedData.tableData.length > 0) {
                const firstRow = parsedData.tableData[0];
                Object.keys(firstRow).forEach(key => {
                  if (key.toLowerCase().includes('selectable') && key !== 'col7') {
                    const colValues = parsedData.tableData.map((row: any) => row[key]?.toLowerCase?.()?.trim()).filter(Boolean);
                    if (colValues.length > 0) {
                      allSelectableValues.push(...colValues);
                    }
                  }
                });
              }
              
              // Check if any column has meaningful boolean-like values
              const hasSelectableValues = allSelectableValues.length > 0 && allSelectableValues.some((val: string) => 
                val === 'true' || val === 'false' || val === 'yes' || val === 'no' || val === '1' || val === '0'
              );
              hasSelectableCol = hasSelectableValues;
            }
            setHasSelectableColumn(hasSelectableCol);
            
            // Save the corrected flag back to localStorage if it was detected (for future loads)
            if (parsedData.hasSelectableColumn === undefined) {
              try {
                const updatedData = {
                  ...parsedData,
                  hasSelectableColumn: hasSelectableCol
                };
                await safeStorageSet(`tableData-${number}`, JSON.stringify(updatedData));
              } catch (error) {
                console.warn('Failed to save hasSelectableColumn flag to localStorage (likely due to size limits):', error);
                // For large transcripts, the flag detection will run again next time, which is acceptable
              }
            }
            
            console.log('Transcript metadata loaded:', {
              hasSegmentColumn: hasSegment,
              hasSelectableColumn: hasSelectableCol,
              extraColumns: parsedData.extraColumns?.length || 0,
              savedWithMetadata: !!parsedData.hasSelectableColumn,
              detectedFromData: parsedData.hasSelectableColumn === undefined
            });
          }
          

          setLoading(false);
        } else {
          console.log('Saved data exists but tableData is empty or invalid');
          
          // Check if the saved data contains placeholder patterns
          if (parsedData.tableData && isPlaceholderData(parsedData.tableData)) {
            console.log('Detected placeholder data in saved data, loading fresh CSV data');
            await loadCSVData();
          } else {
            console.log('Saved data appears to be empty but not placeholder data, loading CSV data');
            await loadCSVData();
          }
        }
      } catch (error) {
        console.error("Error parsing saved data:", error);
        await loadCSVData();
      }
    } else {
      await loadCSVData(); // Load CSV if no saved data
    }
    await fetchSpeakers();
    await fetchContent(); // Fetch grade level text
  };
  
  initializeTranscript();
  }, [number]);

  // Set mounted state after initial load
  useEffect(() => {
    console.log("Mounted effect triggered, loading state:", loading);
    if (!loading) {
      console.log("Setting mounted to true");
      setMounted(true);
    }
  }, [loading]); 
  
  // Set page title based on custom title
  useEffect(() => {
    if (title && title !== "Title..." && title.trim() !== "") {
      document.title = `${title} - EduCoder`;
    } else {
      document.title = `Transcript t${number} - EduCoder`;
    }
  }, [title, number]);
  
  const getRowColor = (speaker: string, speakerColors: { [key: string]: string }) => {
    return speakerColors[speaker] || "bg-gray-100"; // Default to gray if speaker is not found
  };

  // Generate rows for a specific learning goal note
  const generateNoteRows = (note: Note) => {
    return note.rowIndices.map(rowIndex => {
      if (rowIndex >= 0 && rowIndex < tableData.length) {
        return tableData[rowIndex];
      }
      return null;
    }).filter((row): row is TableRow => row !== null);
  };

  // Functions to handle note popup edit mode
  const enterNoteEditMode = (note: Note) => {
    setIsNoteInEditMode(true);
    setNoteEditBuffer({
      title: note.title,
      content_1: note.content_1,
      content_2: note.content_2
    });
  };

  const exitNoteEditMode = () => {
    setIsNoteInEditMode(false);
    setNoteEditBuffer(null);
  };

  const saveNoteChanges = () => {
    if (selectedNotePopup && noteEditBuffer) {
      const noteId = selectedNotePopup.note.id;
      
      // Update the note with buffer values
      setNotes(prevNotes => 
        prevNotes.map(note => 
          note.id === noteId 
            ? { ...note, title: noteEditBuffer.title, content_1: noteEditBuffer.content_1, content_2: noteEditBuffer.content_2 }
            : note
        )
      );

      // Update the popup note reference
      setSelectedNotePopup(prev => 
        prev ? {
          ...prev,
          note: { ...prev.note, title: noteEditBuffer.title, content_1: noteEditBuffer.content_1, content_2: noteEditBuffer.content_2 }
        } : null
      );

      exitNoteEditMode();
    }
  };

  const cancelNoteChanges = () => {
    exitNoteEditMode();
  };

  const [scrollTop, setScrollTop] = useState(0);
  
  // Add scroll handler
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  };

  // Add the export function after handleSubmit
  const handleExport = () => {
    if (!annotationData && (!separateLlmAnnotationData || Object.keys(separateLlmAnnotationData).length === 0)) return;

    const createWorkbook = (data: AnnotationData | null, notesData: Note[], suffix: string) => {
    const wb = utils.book_new();

      if (data) {
        Object.entries(data).forEach(([sheetName, sheetData]) => {
        const sheetRows = [];
        sheetRows.push(['Line #', 'Speaker', 'Utterance', ...sheetData.codes]);

        tableData.forEach((row, index) => {
          const isSelectable = isTableRowSelectable(row);
          const rowData = [
            row.col2, // Line #
            row.col5, // Speaker
            row.col6, // Utterance
            ...sheetData.codes.map(code => {
                if (!isSelectable) return '';
              return sheetData.annotations[index]?.[code] ? '1' : '0';
            })
          ];
          sheetRows.push(rowData);
        });

        const ws = utils.aoa_to_sheet(sheetRows);
        utils.book_append_sheet(wb, ws, sheetName);
      });
    }

      // Add Notes sheet if there are any notes for human annotations
      if (notesData.length > 0 && suffix === 'human') {
      const notesRows = [];
      notesRows.push(['Note ID', 'Title', 'Note Abstract', 'Full Context', 'Associated Lines', 'Associated Utterances']);
      
        notesData.forEach(note => {
        const associatedLines = note.lineNumbers?.length > 0 
          ? note.lineNumbers.join(', ')
          : note.rowIndices.map(index => {
              const tableRow = tableData[index];
              return tableRow ? tableRow.col2 : '';
            }).filter(line => line !== '').join(', ');
        
        const associatedUtterances = note.rowIndices.map(index => {
          const tableRow = tableData[index];
          return tableRow ? `"${tableRow.col6}"` : '';
        }).filter(utterance => utterance !== '""').join('; ');
        
        notesRows.push([
          note.id,
          note.title,
          note.content_1,
          note.content_2,
          associatedLines,
          associatedUtterances
        ]);
      });
      
      const notesWs = utils.aoa_to_sheet(notesRows);
      utils.book_append_sheet(wb, notesWs, 'Notes');
    }

      return wb;
    };

    // If we have LLM annotations, create separate files for each provider
    if (separateLlmAnnotationData) {
      const exportedFiles: string[] = [];
      
      // Create separate files for each LLM provider
      Object.entries(separateLlmAnnotationData).forEach(([provider, providerData]) => {
        const llmWb = createWorkbook(providerData, [], 'llm');
        const providerFileName = provider.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const llmFileName = `transcript_${number}_${providerFileName}_annotations.xlsx`;
        writeFile(llmWb, llmFileName);
        exportedFiles.push(`${provider} annotations`);
      });
      
      // Create human annotations file if we have human annotations
      if (annotationData) {
        const humanWb = createWorkbook(annotationData, notes, 'human');
        const humanFileName = `transcript_${number}_human_annotations.xlsx`;
        writeFile(humanWb, humanFileName);
        exportedFiles.unshift('Human annotations with notes');
      }
      
      const fileList = exportedFiles.map((file, index) => `${index + 1}. ${file}`).join('\n');
      alert(`Exported ${exportedFiles.length} files:\n${fileList}`);
    } else if (annotationData) {
      // Only human annotations exist
      const wb = createWorkbook(annotationData, notes, 'human');
    const fileName = `transcript_${number}_annotations.xlsx`;
    writeFile(wb, fileName);
      alert('Exported human annotations file');
    }
  };

  // Function to validate user ID
  const validateUserId = (id: string): boolean => {
    if (!id.trim()) {
      setUserIdError('User ID is required');
      return false;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
      setUserIdError('User ID can only contain letters, numbers, hyphens, and underscores');
      return false;
    }
    if (id.trim().length < 3 || id.trim().length > 20) {
      setUserIdError('User ID must be between 3 and 20 characters');
      return false;
    }
    setUserIdError('');
    return true;
  };

  // Function to show user ID prompt
  const handleUploadToCloud = async () => {
    if (!annotationData) {
      alert('No annotation data to upload');
      return;
    }
    setShowUserIdPrompt(true);
  };

  // Function to upload XLSX file to Google Cloud Storage
  const handleUploadToCloudWithUserId = async () => {
    if (!annotationData) {
      alert('No annotation data to upload');
      return;
    }
    
    if (!validateUserId(userId)) {
      return;
    }
    
    setUploadStatus('uploading');
    setShowUserIdPrompt(false);

    try {
      // Create the Excel workbook (same logic as export)
      const wb = utils.book_new();

      // For each feature sheet in annotationData
      if (annotationData) {
        Object.entries(annotationData).forEach(([sheetName, sheetData]) => {
          const sheetRows = [];
          sheetRows.push(['Line #', 'Speaker', 'Utterance', ...sheetData.codes]);

          tableData.forEach((row, index) => {
            const isSelectable = isTableRowSelectable(row);
            const rowData = [
              row.col2, // Line #
              row.col5, // Speaker
              row.col6, // Utterance
              ...sheetData.codes.map(code => {
                if (!isSelectable) return '';
                return sheetData.annotations[index]?.[code] ? '1' : '0';
              })
            ];
            sheetRows.push(rowData);
          });

          const ws = utils.aoa_to_sheet(sheetRows);
          utils.book_append_sheet(wb, ws, sheetName);
        });
      }

      // Add Notes sheet if there are any notes
      if (notes.length > 0) {
        const notesRows = [];
        notesRows.push(['Note ID', 'Title', 'Note Abstract', 'Full Context', 'Associated Lines', 'Associated Utterances']);
        
        notes.forEach(note => {
          const associatedLines = note.lineNumbers?.length > 0 
            ? note.lineNumbers.join(', ')
            : note.rowIndices.map(index => {
                const tableRow = tableData[index];
                return tableRow ? tableRow.col2 : '';
              }).filter(line => line !== '').join(', ');
          
          const associatedUtterances = note.rowIndices.map(index => {
            const tableRow = tableData[index];
            return tableRow ? `"${tableRow.col6}"` : '';
          }).filter(utterance => utterance !== '""').join('; ');
          
          notesRows.push([
            note.id,
            note.title,
            note.content_1,
            note.content_2,
            associatedLines,
            associatedUtterances
          ]);
        });
        
        const notesWs = utils.aoa_to_sheet(notesRows);
        utils.book_append_sheet(wb, notesWs, 'Notes');
      }

      // Convert workbook to buffer
      const wbBinary = write(wb, { bookType: 'xlsx', type: 'array' });
      
      // Create a blob from the binary data
      const blob = new Blob([wbBinary], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });

      // Create FormData for file upload
      const formData = new FormData();
      const fileName = `transcript_${number}_annotations_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
      formData.append('file', blob, fileName);
      formData.append('transcriptNumber', number.toString());
      formData.append('userId', userId.trim());

      console.log('Uploading XLSX file to Google Cloud Storage:', {
        fileName: fileName,
        fileSize: blob.size,
        transcriptNumber: number
      });

      // Send to our API that uploads to Google Cloud Storage
      const response = await fetch('/api/upload-xlsx', {
        method: 'POST',
        body: formData,
      });

      const responseData = await response.json();
      console.log('Upload response:', responseData);

      if (response.ok) {
        setUploadStatus('success');
        alert('Successfully uploaded XLSX file to Google Cloud Storage!');
        setTimeout(() => setUploadStatus('idle'), 3000); // Reset after 3 seconds
      } else {
        console.error('Upload failed with response:', responseData);
        throw new Error(responseData.message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading to cloud:', error);
      setUploadStatus('error');
      
      // More detailed error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to upload XLSX file to Google Cloud Storage.\n\nError: ${errorMessage}\n\nPlease check:\n1. Google Cloud credentials are configured\n2. Bucket permissions are set correctly\n3. Network connection is stable`);
      setTimeout(() => setUploadStatus('idle'), 5000); // Reset after 5 seconds for error
    }
  };

    // Handle Compare with LLM
  const handleCompareWithLLM = async () => {
    try {
      console.log('Loading LLM annotations...');
      
      let llmData: AnnotationData = {};
      let dataLoaded = false;
      
      // Try to load Excel format first (multiple sheets)
      try {
        const excelResponse = await fetch(`/api/transcript/t${number}?file=annotated_transcript.xlsx`);
        if (excelResponse.ok) {
          console.log('Loading LLM annotations from annotated_transcript.xlsx');
          const arrayBuffer = await excelResponse.arrayBuffer();
          const workbook = read(arrayBuffer);
          
          console.log('LLM annotation file loaded. Sheet names:', workbook.SheetNames);
          
          // Load all sheets from LLM annotations
          Object.keys(annotationData || {}).forEach(sheetName => {
            if (workbook.SheetNames.includes(sheetName)) {
              console.log('Processing LLM sheet:', sheetName);
              const sheet = workbook.Sheets[sheetName];
              
              const jsonData = utils.sheet_to_json(sheet, { 
                defval: null,
                raw: false
              });
              
              // Extract codes from the first row (headers)
              const headers = Object.keys(jsonData[0] || {});
              console.log(`${sheetName} sheet headers:`, headers);
              
              const codes = headers.filter(header => 
                header !== 'Line #' && 
                header !== 'Speaker' && 
                header !== 'Utterance' &&
                header !== '#' &&
                header !== 'Dialogue' &&
                header !== 'Segment' &&  // For Talk sheet, exclude Segment from codes
                header !== 'lastSaved' &&
                header !== 'lastActivity' &&
                header !== 'lastModifiedBy'  // Prevent metadata from being treated as codes
              );
              
              console.log(`${sheetName} sheet codes:`, codes);
              
              // Convert LLM data to our annotation format
              const annotations: { [key: number]: { [code: string]: any } } = {};
              
              jsonData.forEach((row: any, rowIndex: number) => {
                if (sheetName === 'Talk') {
                  // For Talk sheet, use row index directly since it's summary data
                  annotations[rowIndex] = {};
                  
                  codes.forEach(code => {
                    const value = row[code];
                    let processedValue;
                    
                    // For Talk sheet, preserve the original data types
                    if (code === 'Response Latency' || code === 'Turn Latency') {
                      // Handle latency values as decimal numbers
                      processedValue = typeof value === 'number' ? value : parseFloat(value) || 0;
                    } else if (typeof value === 'string' && !isNaN(Number(value))) {
                      processedValue = Number(value);
                    } else if (typeof value === 'number') {
                      processedValue = value;
                    } else {
                      processedValue = value;
                    }
                    
                    annotations[rowIndex][code] = processedValue;
                  });
                  
                  // Also store metadata for Talk sheet
                  annotations[rowIndex]['Segment'] = row['Segment'];
                  annotations[rowIndex]['Speaker'] = row['Speaker'];
                  
                  // Handle duration columns specifically
                  if (row['Total Duration']) {
                    annotations[rowIndex]['Total Duration'] = row['Total Duration'];
                  }
                  if (row['Duration']) {
                    annotations[rowIndex]['Duration'] = row['Duration'];
                  }
                  
                  // Handle latency columns specifically
                  if (row['Response Latency']) {
                    annotations[rowIndex]['Response Latency'] = parseFloat(row['Response Latency']) || 0;
                  }
                  if (row['Turn Latency']) {
                    annotations[rowIndex]['Turn Latency'] = parseFloat(row['Turn Latency']) || 0;
                  }
                  
                  // Handle crosstalk variations
                  if (row['Crosstalk Count'] !== undefined) {
                    annotations[rowIndex]['Crosstalk Count'] = Number(row['Crosstalk Count']) || 0;
                  } else if (row['Crosstalk'] !== undefined) {
                    annotations[rowIndex]['Crosstalk Count'] = Number(row['Crosstalk']) || 0;
                  } else if (row['CrossTalk'] !== undefined) {
                    annotations[rowIndex]['Crosstalk Count'] = Number(row['CrossTalk']) || 0;
                  } else if (row['Cross Talk'] !== undefined) {
                    annotations[rowIndex]['Crosstalk Count'] = Number(row['Cross Talk']) || 0;
                  }
                } else {
                  const lineNumber = row['Line #'] || row['#'] || row['Line Number'];
                  
                  if (lineNumber) {
                    // Find the corresponding table row index by matching line numbers
                    const tableRowIndex = tableData.findIndex(tableRow => tableRow.col2 === parseInt(lineNumber, 10));
                    
                    if (tableRowIndex >= 0) {
                      annotations[tableRowIndex] = {};
                      
                      codes.forEach(code => {
                        const value = row[code];
                        let processedValue;
                        if (sheetName === 'Lexical') {
                          // For Lexical category, keep numeric values
                          processedValue = typeof value === 'number' ? value : (parseInt(value) || 0);
                        } else {
                          // For most categories, convert to boolean
                          if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
                            processedValue = false;
                          } else {
                            processedValue = Number(value) === 1 || value === 1 || value === 1.0 || value === "1" || value === true || value === "true";
                          }
                        }
                        annotations[tableRowIndex][code] = processedValue;
                      });
                    }
                  }
                }
              });
              
              llmData[sheetName] = {
                codes,
                definitions: annotationData?.[sheetName]?.definitions || {},
                annotations
              };
            }
          });
          
          dataLoaded = true;
        }
      } catch (excelError) {
        console.log('Excel file not found or error loading it, trying CSV format...');
      }
      
      // If Excel didn't work, try CSV format (single file with all annotations)
      if (!dataLoaded) {
        try {
          const csvResponse = await fetch(`/api/transcript/t${number}?file=annotated_transcript.csv`);
          if (csvResponse.ok) {
            console.log('Loading LLM annotations from annotated_transcript.csv');
            const csvText = await csvResponse.text();
            
            // Parse CSV using Papa Parse
            const { data: csvData } = Papa.parse(csvText, {
              header: true,
              skipEmptyLines: true
            });
            
            console.log('CSV data loaded:', csvData.slice(0, 3));
            
            // Get all available annotation columns (excluding metadata columns)
            const metadataColumns = [
              '#', 'In cue', 'Out cue', 'Duration', 'Speaker', 'Language', 'Dialogue', 
              'Annotations', 'Error Type', 'Segment', 'Selectable',
              'lastSaved', 'lastActivity', 'lastModifiedBy'  // Prevent metadata from being treated as columns
            ];
            const allHeaders = Object.keys(csvData[0] || {});
            const annotationColumns = allHeaders.filter(header => !metadataColumns.includes(header));
            
            console.log('Available annotation columns:', annotationColumns);
            
            // Group annotation columns by category based on known patterns
            const conceptualCodes = annotationColumns.filter(col => [
              'explain_reason', 'claim_math', 'apology', 'question_s', 'compare', 'agree', 'revoice', 'redirect', 
              'help_math', 'nextstep', 'question_g', 'addon', 'disagree', 'explain_action', 'help_non', 
              'Mathcompetent', 'Langcompetent', 'Understanding'
            ].includes(col));
            
            const discursiveCodes = annotationColumns.filter(col => [
              'Offtask', 'Recording', 'Directions'
            ].includes(col));
            
            const lexicalCodes = annotationColumns.filter(col => {
              // Add any LIWC or lexical analysis columns here if they exist
              const lexicalColumns: string[] = [];
              return lexicalColumns.includes(col);
            });
            
            // Create annotation data for each category
            if (conceptualCodes.length > 0) {
              const conceptualAnnotations: { [key: number]: { [code: string]: any } } = {};
              
              csvData.forEach((row: any) => {
                const lineNumber = parseInt(row['#']);
                if (!isNaN(lineNumber)) {
                  const tableRowIndex = tableData.findIndex(tableRow => tableRow.col2 === lineNumber);
                  
                  if (tableRowIndex >= 0) {
                    conceptualAnnotations[tableRowIndex] = {};
                    
                    conceptualCodes.forEach(code => {
                      const value = row[code];
                      let processedValue;
                      if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
                        processedValue = false;
                      } else {
                        // Convert to boolean: only 1 or "1" or true should be true
                        processedValue = Number(value) === 1 || value === 1 || value === 1.0 || value === "1" || value === true || value === "true";
                      }
                      conceptualAnnotations[tableRowIndex][code] = processedValue;
                    });
                  }
                }
              });
              
              llmData['Conceptual'] = {
                codes: conceptualCodes,
                definitions: annotationData?.['Conceptual']?.definitions || {},
                annotations: conceptualAnnotations
              };
            }
            
            if (discursiveCodes.length > 0) {
              const discursiveAnnotations: { [key: number]: { [code: string]: any } } = {};
              
              csvData.forEach((row: any) => {
                const lineNumber = parseInt(row['#']);
                if (!isNaN(lineNumber)) {
                  const tableRowIndex = tableData.findIndex(tableRow => tableRow.col2 === lineNumber);
                  
                  if (tableRowIndex >= 0) {
                    discursiveAnnotations[tableRowIndex] = {};
                    
                    discursiveCodes.forEach(code => {
                      const value = row[code];
                      let processedValue;
                      if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
                        processedValue = false;
                      } else {
                        // Convert to boolean: only 1 or "1" or true should be true
                        processedValue = Number(value) === 1 || value === 1 || value === 1.0 || value === "1" || value === true || value === "true";
                      }
                      discursiveAnnotations[tableRowIndex][code] = processedValue;
                    });
                  }
                }
              });
              
              llmData['Discursive'] = {
                codes: discursiveCodes,
                definitions: annotationData?.['Discursive']?.definitions || {},
                annotations: discursiveAnnotations
              };
            }
            
            dataLoaded = true;
          }
        } catch (csvError) {
          console.error('Error loading CSV format:', csvError);
        }
      }
      
      if (dataLoaded) {
        console.log('Setting LLM annotation data:', llmData);
        setLlmAnnotationData(llmData);
        setShowLLMComparison(true);
      } else {
        throw new Error('No LLM annotation files found');
      }
      
    } catch (error) {
      console.error('Error loading LLM annotations:', error);
      alert('Failed to load LLM annotations. Please check if annotated_transcript.xlsx or annotated_transcript.csv exists in the transcript folder.');
    }
  };

  // Handle Compare with Experts
  const handleCompareWithExperts = async () => {
    try {
      console.log('Loading expert annotations...');
      
              const excelResponse = await fetch(`/api/transcript/t${number}?file=expert_annotations.xlsx`);
      if (!excelResponse.ok) {
        throw new Error('Expert annotations file not found');
      }
      
      const arrayBuffer = await excelResponse.arrayBuffer();
      const workbook = read(arrayBuffer);
      
      console.log('Expert annotation file loaded. Sheet names:', workbook.SheetNames);
      
      // Find the notes sheet - try multiple possible names
      const possibleNotesSheetNames = ['What Students Are Saying', 'Notes', 'Student Notes', 'What Students are Saying'];
      let notesSheet = null;
      let notesSheetName = '';
      
      for (const sheetName of possibleNotesSheetNames) {
        if (workbook.Sheets[sheetName]) {
          notesSheet = workbook.Sheets[sheetName];
          notesSheetName = sheetName;
          break;
        }
      }
      
      if (!notesSheet) {
        // If no notes sheet found, try the first sheet that isn't "Annotated Transcript"
        const firstNonTranscriptSheet = workbook.SheetNames.find(name => 
          !name.toLowerCase().includes('annotated') && !name.toLowerCase().includes('transcript')
        );
        if (firstNonTranscriptSheet) {
          notesSheet = workbook.Sheets[firstNonTranscriptSheet];
          notesSheetName = firstNonTranscriptSheet;
          console.log(`Using sheet "${firstNonTranscriptSheet}" as notes sheet`);
        } else {
          throw new Error(`Notes sheet not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
      } else {
        console.log(`Found notes sheet: "${notesSheetName}"`);
      }
      
      const notesData = utils.sheet_to_json(notesSheet, { 
        defval: null,
        raw: false
      });
      
      // Fix column names - the visible columns are named "Expert 1.1", "Expert 2.1", etc.
      // but should be "Expert 1", "Expert 2", etc. to match the transcript sheet
      const fixedNotesData = notesData.map(row => {
        const fixedRow: Record<string, unknown> = {};
        if (row && typeof row === 'object') {
          for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
            if (key === 'Expert 1.1') {
              fixedRow['Expert 1'] = value;
            } else if (key === 'Expert 2.1') {
              fixedRow['Expert 2'] = value;
            } else if (key === 'Expert 3.1') {
              fixedRow['Expert 3'] = value;
            } else {
              fixedRow[key] = value;
            }
          }
        }
        return fixedRow;
      });
      
      // Find the transcript sheet - try multiple possible names
      const possibleTranscriptSheetNames = ['Annotated Transcript', 'Transcript', 'Annotations', 'Annotated transcript'];
      let transcriptSheet = null;
      let transcriptSheetName = '';
      
      for (const sheetName of possibleTranscriptSheetNames) {
        if (workbook.Sheets[sheetName]) {
          transcriptSheet = workbook.Sheets[sheetName];
          transcriptSheetName = sheetName;
          break;
        }
      }
      
      if (!transcriptSheet) {
        // If no transcript sheet found, try the first sheet that isn't the notes sheet
        const firstNonNotesSheet = workbook.SheetNames.find(name => name !== notesSheetName);
        if (firstNonNotesSheet) {
          transcriptSheet = workbook.Sheets[firstNonNotesSheet];
          transcriptSheetName = firstNonNotesSheet;
          console.log(`Using sheet "${firstNonNotesSheet}" as transcript sheet`);
        } else {
          throw new Error(`Transcript sheet not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
      } else {
        console.log(`Found transcript sheet: "${transcriptSheetName}"`);
      }
      
      const transcriptData = utils.sheet_to_json(transcriptSheet, { 
        defval: null,
        raw: false
      });
      
      console.log('Expert notes data:', notesData.slice(0, 3));
      console.log('Expert transcript data:', transcriptData.slice(0, 3));
      
      setExpertsAnnotationData({
        notes: fixedNotesData as Record<string, unknown>[],
        transcript: transcriptData as Record<string, unknown>[]
      });
      setShowExpertsComparison(true);
      
    } catch (error) {
      console.error('Error loading expert annotations:', error);
      alert('Failed to load expert annotations. Please check if expert_annotations.xlsx exists in the transcript folder.');
    }
  };

  // Handle Compare with LLM Analysis (transcript_analysis.xlsx)
  const handleCompareWithLLMAnalysis = async () => {
    try {
      console.log('Loading LLM analysis annotations...');
      
              const excelResponse = await fetch(`/api/transcript/t${number}?file=transcript_analysis.xlsx`);
      if (!excelResponse.ok) {
        throw new Error('LLM analysis file not found');
      }
      
      const arrayBuffer = await excelResponse.arrayBuffer();
      const workbook = read(arrayBuffer);
      
      console.log('LLM analysis file loaded. Sheet names:', workbook.SheetNames);
      
      // Find the notes sheet - try multiple possible names
      const possibleNotesSheetNames = ['What Students Are Saying', 'Notes', 'Student Notes', 'What Students are Saying'];
      let notesSheet = null;
      let notesSheetName = '';
      
      for (const sheetName of possibleNotesSheetNames) {
        if (workbook.Sheets[sheetName]) {
          notesSheet = workbook.Sheets[sheetName];
          notesSheetName = sheetName;
          break;
        }
      }
      
      if (!notesSheet) {
        throw new Error(`Notes sheet not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
      }
      
      console.log(`Found notes sheet: "${notesSheetName}"`);
      
      const notesData = utils.sheet_to_json(notesSheet, { 
        defval: null,
        raw: false
      });
      
      // Fix null values in notes data
      const fixedNotesData = notesData.map(row => {
        const fixedRow: Record<string, unknown> = {};
        Object.keys(row as Record<string, unknown>).forEach(key => {
          fixedRow[key] = (row as any)[key] === null ? '' : (row as any)[key];
        });
        return fixedRow;
      });
      
      // Find the transcript sheet - try multiple possible names
      const possibleTranscriptSheetNames = ['Transcript', 'transcript', 'Sheet1', 'Data'];
      let transcriptSheet = null;
      let transcriptSheetName = '';
      
      for (const sheetName of possibleTranscriptSheetNames) {
        if (workbook.Sheets[sheetName]) {
          transcriptSheet = workbook.Sheets[sheetName];
          transcriptSheetName = sheetName;
          break;
        }
      }
      
      if (!transcriptSheet) {
        // If no transcript sheet found, try the first sheet that isn't the notes sheet
        const firstNonNotesSheet = workbook.SheetNames.find(name => name !== notesSheetName);
        if (firstNonNotesSheet) {
          transcriptSheet = workbook.Sheets[firstNonNotesSheet];
          transcriptSheetName = firstNonNotesSheet;
          console.log(`Using sheet "${firstNonNotesSheet}" as transcript sheet`);
        } else {
          throw new Error(`Transcript sheet not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
        }
      } else {
        console.log(`Found transcript sheet: "${transcriptSheetName}"`);
      }
      
      const transcriptData = utils.sheet_to_json(transcriptSheet, { 
        defval: null,
        raw: false
      });
      
      console.log('LLM analysis notes data:', notesData.slice(0, 3));
      console.log('LLM analysis transcript data:', transcriptData.slice(0, 3));
      
      setLlmAnalysisData({
        notes: fixedNotesData as Record<string, unknown>[],
        transcript: transcriptData as Record<string, unknown>[]
      });
      setShowLLMAnalysisComparison(true);
      
    } catch (error) {
      console.error('Error loading LLM analysis annotations:', error);
      alert('Failed to load LLM analysis annotations. Please check if transcript_analysis.xlsx exists in the transcript folder.');
    }
  };

  // Handle Unified Comparison (combines both Expert and LLM Analysis)
  const handleLLMAnnotationComplete = async (annotations: any, provider?: string) => {
    // Load existing annotation data first to preserve other categories
    let existingAnnotations: AnnotationData = {};
    const existingData = await safeStorageGet(`annotations-${number}`);
    if (existingData) {
      try {
        const parsed = JSON.parse(existingData);
        // Filter out metadata columns that might have been saved
        const cleanedParsed = Object.keys(parsed).reduce((acc, key) => {
          if (!METADATA_COLUMNS.includes(key)) {
            acc[key] = parsed[key];
          }
          return acc;
        }, {} as any);
        existingAnnotations = cleanedParsed;
      } catch (error) {
        console.error('Error parsing existing annotations:', error);
      }
    }
    
    // Convert LLM annotations to the format expected by the annotation system
    const convertedAnnotations: AnnotationData = { ...existingAnnotations };
    
    // Get feature definitions once for all categories
    const featureDefinitions = await safeStorageGet('feature-definitions');
    let parsedFeatureDefinitions = null;
    if (featureDefinitions) {
      parsedFeatureDefinitions = JSON.parse(featureDefinitions);
    }
    
    for (const category of Object.keys(annotations)) {
      convertedAnnotations[category] = {
        codes: [],
        definitions: {},
        annotations: {}
      };
      
      // Use the pre-loaded feature definitions for this category
      if (parsedFeatureDefinitions) {
        const categoryFeatures = parsedFeatureDefinitions.features[category] || [];
        
        // Set codes and definitions
        convertedAnnotations[category].codes = categoryFeatures.map((f: any) => f.Code);
        categoryFeatures.forEach((feature: any) => {
          convertedAnnotations[category].definitions[feature.Code] = {
            Definition: feature.Definition || '',
            example1: feature.Example1 || feature.example1 || '',
            example2: feature.Example2 || feature.example2 || '',
            nonexample1: feature.NonExample1 || feature.nonexample1 || '',
            nonexample2: feature.NonExample2 || feature.nonexample2 || ''
          };
        });
      }
      
      // Set annotations
      Object.keys(annotations[category]).forEach(lineNumber => {
        const lineIndex = parseInt(lineNumber) - 1; // Convert to 0-based index
        convertedAnnotations[category].annotations[lineIndex] = annotations[category][lineNumber];
      });
    }
    
    // Save the LLM annotations separately from human annotations, organized by provider
    const providerKey = provider === 'openai' ? 'ChatGPT-4o' : provider === 'claude' ? 'Claude-4-Sonnet' : (provider || 'Unknown');
    const llmAnnotationKey = `llm-annotations-${number}`;
    
    // Load existing LLM annotations from all providers
    const existingLlmAnnotations = await safeStorageGet(llmAnnotationKey);
    let allLlmAnnotations: {[provider: string]: AnnotationData} = {};
    
    if (existingLlmAnnotations) {
      try {
        allLlmAnnotations = JSON.parse(existingLlmAnnotations);
      } catch (error) {
        console.error('Error parsing existing LLM annotations:', error);
      }
    }
    
    // Update the main annotation data with merged results
    setAnnotationData(convertedAnnotations);
    await safeStorageSet(`annotations-${number}`, JSON.stringify(convertedAnnotations));
    
    // Add or update annotations for this provider
    allLlmAnnotations[providerKey] = convertedAnnotations;
    await safeStorageSet(llmAnnotationKey, JSON.stringify(allLlmAnnotations));
    
    // Add timestamp for tracking
    const llmMetaKey = `llm-meta-${number}`;
    const existingMeta = await safeStorageGet(llmMetaKey);
    let allMeta: {[provider: string]: any} = {};
    
    if (existingMeta) {
      try {
        allMeta = JSON.parse(existingMeta);
      } catch (error) {
        console.error('Error parsing existing LLM metadata:', error);
      }
    }
    
    allMeta[providerKey] = {
      generatedAt: new Date().toISOString(),
      provider: providerKey,
      featuresAnnotated: Object.keys(annotations)
    };
    await safeStorageSet(llmMetaKey, JSON.stringify(allMeta));
    
    // Reload annotation data to show the new annotations
    await reloadAnnotationData();
    
    // Show success message
    const annotatedCategories = Object.keys(annotations).join(', ');
    alert(`${providerKey} annotations have been generated for ${annotatedCategories} features and merged with your existing annotations!`);
  };

  const handleUnifiedComparison = async () => {
    try {
      console.log('Loading unified comparison data...');
      
      // Load Expert data
      let expertsData = null;
      try {
        const expertsResponse = await fetch(`/api/transcript/t${number}?file=expert_annotations.xlsx`);
        if (expertsResponse.ok) {
          const expertsArrayBuffer = await expertsResponse.arrayBuffer();
          const expertsWorkbook = read(expertsArrayBuffer);
          
          // Find notes sheet
          const possibleNotesSheetNames = ['What Students Are Saying', 'Notes', 'Student Notes', 'What Students are Saying'];
          let notesSheet = null;
          let notesSheetName = '';
          
          for (const sheetName of possibleNotesSheetNames) {
            if (expertsWorkbook.Sheets[sheetName]) {
              notesSheet = expertsWorkbook.Sheets[sheetName];
              notesSheetName = sheetName;
              break;
            }
          }
          
          if (!notesSheet) {
            const firstNonTranscriptSheet = expertsWorkbook.SheetNames.find(name => 
              !name.toLowerCase().includes('annotated') && !name.toLowerCase().includes('transcript')
            );
            if (firstNonTranscriptSheet) {
              notesSheet = expertsWorkbook.Sheets[firstNonTranscriptSheet];
              notesSheetName = firstNonTranscriptSheet;
            }
          }
          
          if (notesSheet) {
            const notesData = utils.sheet_to_json(notesSheet, { defval: null, raw: false });
            const fixedNotesData = notesData.map(row => {
              const fixedRow: Record<string, unknown> = {};
              if (row && typeof row === 'object') {
                for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
                  if (key === 'Expert 1.1') {
                    fixedRow['Expert 1'] = value;
                  } else if (key === 'Expert 2.1') {
                    fixedRow['Expert 2'] = value;
                  } else if (key === 'Expert 3.1') {
                    fixedRow['Expert 3'] = value;
                  } else {
                    fixedRow[key] = value;
                  }
                }
              }
              return fixedRow;
            });
            
            // Find the transcript sheet
            const possibleTranscriptSheetNames = ['Annotated Transcript', 'Transcript', 'Annotations', 'Annotated transcript'];
            let transcriptSheet = null;
            let transcriptSheetName = '';
            
            for (const sheetName of possibleTranscriptSheetNames) {
              if (expertsWorkbook.Sheets[sheetName]) {
                transcriptSheet = expertsWorkbook.Sheets[sheetName];
                transcriptSheetName = sheetName;
                break;
              }
            }
            
            if (!transcriptSheet) {
              const firstNonNotesSheet = expertsWorkbook.SheetNames.find(name => name !== notesSheetName);
              if (firstNonNotesSheet) {
                transcriptSheet = expertsWorkbook.Sheets[firstNonNotesSheet];
                transcriptSheetName = firstNonNotesSheet;
              }
            }
            
            const transcriptData = transcriptSheet ? utils.sheet_to_json(transcriptSheet, { defval: null, raw: false }) : [];
            
            expertsData = {
              notes: fixedNotesData as Record<string, unknown>[],
              transcript: transcriptData as Record<string, unknown>[]
            };
            console.log('Expert data loaded successfully');
          }
        }
      } catch (error) {
        console.log('Expert data not available:', error);
      }
      
      // Load LLM Analysis data
      let llmData = null;
      try {
        const llmResponse = await fetch(`/api/transcript/t${number}?file=transcript_analysis.xlsx`);
        if (llmResponse.ok) {
          const llmArrayBuffer = await llmResponse.arrayBuffer();
          const llmWorkbook = read(llmArrayBuffer);
          
          // Find notes sheet
          const possibleNotesSheetNames = ['What Students Are Saying', 'Notes', 'Student Notes', 'What Students are Saying'];
          let notesSheet = null;
          let notesSheetName = '';
          
          for (const sheetName of possibleNotesSheetNames) {
            if (llmWorkbook.Sheets[sheetName]) {
              notesSheet = llmWorkbook.Sheets[sheetName];
              notesSheetName = sheetName;
              break;
            }
          }
          
          if (notesSheet) {
            const notesData = utils.sheet_to_json(notesSheet, { defval: null, raw: false });
            const fixedNotesData = notesData.map(row => {
              const fixedRow: Record<string, unknown> = {};
              Object.keys(row as Record<string, unknown>).forEach(key => {
                fixedRow[key] = (row as any)[key] === null ? '' : (row as any)[key];
              });
              return fixedRow;
            });
            
            // Find the transcript sheet
            const possibleTranscriptSheetNames = ['Transcript', 'transcript', 'Sheet1', 'Data'];
            let transcriptSheet = null;
            let transcriptSheetName = '';
            
            for (const sheetName of possibleTranscriptSheetNames) {
              if (llmWorkbook.Sheets[sheetName]) {
                transcriptSheet = llmWorkbook.Sheets[sheetName];
                transcriptSheetName = sheetName;
                break;
              }
            }
            
            if (!transcriptSheet) {
              const firstNonNotesSheet = llmWorkbook.SheetNames.find(name => name !== notesSheetName);
              if (firstNonNotesSheet) {
                transcriptSheet = llmWorkbook.Sheets[firstNonNotesSheet];
                transcriptSheetName = firstNonNotesSheet;
              }
            }
            
            const transcriptData = transcriptSheet ? utils.sheet_to_json(transcriptSheet, { defval: null, raw: false }) : [];
            
            llmData = {
              notes: fixedNotesData as Record<string, unknown>[],
              transcript: transcriptData as Record<string, unknown>[]
            };
            console.log('LLM data loaded successfully');
          }
        }
      } catch (error) {
        console.log('LLM data not available:', error);
      }
      
      // Check if at least one data source is available
      if (!expertsData && !llmData) {
        alert('No comparison data available. Please ensure expert_annotations.xlsx or transcript_analysis.xlsx exists in the transcript folder.');
        return;
      }
      
      setExpertsAnnotationData(expertsData);
      setLlmAnalysisData(llmData);
      setShowUnifiedComparison(true);
      
    } catch (error) {
      console.error('Error loading unified comparison data:', error);
      alert('Failed to load comparison data. Please check the file availability.');
    }
  };



  // Optimize feature change handler with batched updates and comprehensive error handling
  const handleFeatureChange = React.useCallback((lineNumber: number, code: string, value: boolean) => {
    try {
      // Validate inputs
      if (typeof lineNumber !== 'number' || lineNumber < 0) {
        console.error('Invalid line number:', lineNumber);
        return;
      }
      
      if (typeof code !== 'string' || !code.trim()) {
        console.error('Invalid code:', code);
        return;
      }
      
      // Preserve scroll position to prevent jumping to top
      const scrollContainer = document.querySelector('.overflow-auto') || document.documentElement || window;
      const currentScrollTop = scrollContainer instanceof Window ? scrollContainer.scrollY : 
                               scrollContainer === document.documentElement ? document.documentElement.scrollTop : 
                               scrollContainer.scrollTop;
      
      console.log('handleFeatureChange called:', { lineNumber, code, value, ALLOWED_SHEETS });
      
    setAnnotationData(prev => {
        if (!prev || typeof prev !== 'object') {
          console.log('No previous annotation data or invalid data type');
          return prev;
        }
      
        // Find which category this code belongs to by searching through all categories in annotationData
      let targetCategory = null;
        const availableCategories = Object.keys(prev);
        console.log('Available categories in annotationData:', availableCategories);
        
        for (const category of availableCategories) {
          if (prev[category]?.codes && Array.isArray(prev[category].codes) && prev[category].codes.includes(code)) {
          targetCategory = category;
            console.log('Found target category:', targetCategory, 'for code:', code);
          break;
        }
      }
      
        if (!targetCategory) {
          console.log('No target category found for code:', code, 'Available categories:', availableCategories);
          // Try to find by checking all codes in all categories
          for (const category of availableCategories) {
            console.log(`Category ${category} codes:`, prev[category]?.codes);
          }
          return prev;
        }
      
      const currentSheet = prev[targetCategory];
        if (!currentSheet || typeof currentSheet !== 'object') {
          console.log('No current sheet found for category:', targetCategory);
          return prev;
        }

        // Validate currentSheet structure
        if (!Array.isArray(currentSheet.codes) || !currentSheet.annotations || typeof currentSheet.annotations !== 'object') {
          console.error('Invalid current sheet structure for category:', targetCategory);
          return prev;
        }

      const currentAnnotations = currentSheet.annotations[lineNumber];
        if (currentAnnotations?.[code] === value) {
          console.log('Value unchanged, skipping update');
          return prev;
        }

        console.log('Updating annotation:', { targetCategory, lineNumber, code, value });
        
        const newAnnotationData = {
        ...prev,
        [targetCategory]: {
          ...currentSheet,
          annotations: {
            ...currentSheet.annotations,
            [lineNumber]: {
              ...currentAnnotations,
              [code]: value
            }
          }
        }
      };
        

        
        return newAnnotationData;
      });
      
      // Restore scroll position after state update to prevent jumping to top
      // Use requestAnimationFrame to ensure DOM has been updated
      requestAnimationFrame(() => {
        if (scrollContainer instanceof Window) {
          scrollContainer.scrollTo(0, currentScrollTop);
        } else if (scrollContainer === document.documentElement) {
          document.documentElement.scrollTop = currentScrollTop;
        } else {
          scrollContainer.scrollTop = currentScrollTop;
        }
      });
      
    } catch (error) {
      console.error('Error in handleFeatureChange:', error);
    }
  }, [number]);

  const [showOnlyStudent, setShowOnlyStudent] = useState(false);
  const [isNotesPanelCollapsed, setIsNotesPanelCollapsed] = useState(false);
  const [showPromptPopup, setShowPromptPopup] = useState(false);
  const [selectedNotePopup, setSelectedNotePopup] = useState<{
    note: Note;
    noteRows: TableRow[];
  } | null>(null);
  const [isNoteInEditMode, setIsNoteInEditMode] = useState(false);
  const [noteEditBuffer, setNoteEditBuffer] = useState<{
    title: string;
    content_1: string;
    content_2: string;
  } | null>(null);

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Add useEffect for handling click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (learningGoalNotePopup && !(event.target as Element).closest('.learning-goal-popup')) {
        setLearningGoalNotePopup(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [learningGoalNotePopup]);

  // Add state for tracking duplicate title validation
  const [titleValidationError, setTitleValidationError] = useState<string>('');

  // Function to check if a title already exists (excluding the current note)
  const checkTitleExists = (title: string, currentNoteId?: number): boolean => {
    const trimmedTitle = title.trim().toLowerCase();
    if (trimmedTitle === '') return false;
    
    return notes.some(note => 
      note.id !== currentNoteId && 
      note.title.trim().toLowerCase() === trimmedTitle
    );
  };

  // Functions for in-place content editing
  const startEditingTitle = () => {
    setTempTitle(title);
    setIsEditingTitle(true);
  };

  const startEditingInstruction = () => {
    setTempInstruction(instruction);
    setIsEditingInstruction(true);
  };

  const saveTitle = async () => {
    try {
      // Get current content first
      const getResponse = await fetch(`/api/update-content?transcriptId=t${number}`);
      const { content: currentContent } = await getResponse.json();
      
      // Update with new title
      const updatedContent = {
        ...currentContent,
        title: tempTitle
      };
      
      const response = await fetch('/api/update-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptId: `t${number}`,
          content: updatedContent,
        }),
      });

      const result = await response.json();
      
      if (response.ok) {
        setTitle(tempTitle);
        setIsEditingTitle(false);
        
        // If public folder is not writable, save to localStorage
        if (result.useLocalStorage || result.localStorageOnly) {
          try {
            await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
            console.log('Grade level saved to localStorage');
          } catch (storageError) {
            console.error('Failed to save to localStorage:', storageError);
          }
        }
        
        // Also save to local settings file
        try {
          const settingsResponse = await fetch('/api/save-transcript-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptId: `t${number}`,
              title: tempTitle,
              instruction: instruction // Include current lesson goal
            }),
          });
          
          const settingsResult = await settingsResponse.json();
          if (settingsResult.success) {
            console.log('Grade level saved to local settings file');
          } else if (!settingsResult.isServerless) {
            console.warn('Failed to save to settings file:', settingsResult.error);
          }
        } catch (settingsError) {
          console.error('Error saving to settings file:', settingsError);
        }
      } else {
        alert('Failed to save grade level');
      }
    } catch (error) {
      console.error('Error saving grade level:', error);
      // Try to save to localStorage as fallback
      try {
        const existingContentRaw = await safeStorageGet(`t${number}-content.json`);
        const existingContent = existingContentRaw ? JSON.parse(existingContentRaw) : {};
        const updatedContent = {
          ...existingContent,
          title: tempTitle
        };
        await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
        setTitle(tempTitle);
        setIsEditingTitle(false);
        console.log('Grade level saved to localStorage as fallback');
        
        // Also try to save to settings file as fallback
        try {
          const settingsResponse = await fetch('/api/save-transcript-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptId: `t${number}`,
              title: tempTitle,
              instruction: instruction
            }),
          });
          
          const settingsResult = await settingsResponse.json();
          if (settingsResult.success) {
            console.log('Grade level saved to local settings file as fallback');
          }
        } catch {
          console.log('Settings file save skipped in fallback mode');
        }
      } catch (storageError) {
        console.error('Failed to save to localStorage fallback:', storageError);
        alert('Failed to save grade level');
      }
    }
  };

  const saveInstruction = async () => {
    try {
      // Get current content first
      const getResponse = await fetch(`/api/update-content?transcriptId=t${number}`);
      const { content: currentContent } = await getResponse.json();
      
      // Update with new instruction and context
      const updatedContent = {
        ...currentContent,
        instruction: tempInstruction
      };
      
      const response = await fetch('/api/update-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcriptId: `t${number}`,
          content: updatedContent,
        }),
      });

      const result = await response.json();
      
      if (response.ok) {
        setInstruction(tempInstruction);
        setIsEditingInstruction(false);
        
        // If public folder is not writable, save to localStorage
        if (result.useLocalStorage || result.localStorageOnly) {
          try {
            await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
            console.log('Instruction and context saved to localStorage');
          } catch (storageError) {
            console.error('Failed to save to localStorage:', storageError);
          }
        }
        
        // Also save to local settings file
        try {
          const settingsResponse = await fetch('/api/save-transcript-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptId: `t${number}`,
              title: title, // Include current grade level
              instruction: tempInstruction
            }),
          });
          
          const settingsResult = await settingsResponse.json();
          if (settingsResult.success) {
            console.log('Instruction and context saved to local settings file');
          } else if (!settingsResult.isServerless) {
            console.warn('Failed to save to settings file:', settingsResult.error);
          }
        } catch (settingsError) {
          console.error('Error saving to settings file:', settingsError);
        }
      } else {
        alert('Failed to save instruction and context');
      }
    } catch (error) {
      console.error('Error saving instruction and context:', error);
      // Try to save to localStorage as fallback
      try {
        const existingContentRaw = await safeStorageGet(`t${number}-content.json`);
        const existingContent = existingContentRaw ? JSON.parse(existingContentRaw) : {};
        const updatedContent = {
          ...existingContent,
          instruction: tempInstruction
        };
        await safeStorageSet(`t${number}-content.json`, JSON.stringify(updatedContent));
        setInstruction(tempInstruction);
        setIsEditingInstruction(false);
        console.log('Instruction and context saved to localStorage as fallback');
        
        // Also try to save to settings file as fallback
        try {
          const settingsResponse = await fetch('/api/save-transcript-settings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcriptId: `t${number}`,
              title: title,
              instruction: tempInstruction
            }),
          });
          
          const settingsResult = await settingsResponse.json();
          if (settingsResult.success) {
            console.log('Instruction and context saved to local settings file as fallback');
          }
        } catch {
          console.log('Settings file save skipped in fallback mode');
        }
      } catch (storageError) {
        console.error('Failed to save to localStorage fallback:', storageError);
        alert('Failed to save instruction and context');
      }
    }
  };

  const cancelEditingTitle = () => {
    setTempTitle("");
    setIsEditingTitle(false);
  };

  const cancelEditingInstruction = () => {
    setTempInstruction("");
    setIsEditingInstruction(false);
  };

  // Handle click outside to close hidden columns dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showHiddenColumnsDropdown) {
        const target = event.target as Element;
        const dropdown = target.closest('.relative');
        if (!dropdown || !dropdown.contains(target)) {
          setShowHiddenColumnsDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHiddenColumnsDropdown]);

  // Helper to get transcript data for LLM
  const getTranscriptDataForLLM = () => {
    return tableData.map((row, idx) => ({
      lineNumber: row.col2,
      speaker: row.col5,
      utterance: row.col6
    }));
  };

  // Helper to update feature definitions for LLM
  const updateFeatureDefinitionsForLLM = async () => {
    const featureDefinitionsData = await safeStorageGet('feature-definitions');
    if (featureDefinitionsData) {
      const parsed = JSON.parse(featureDefinitionsData);
      setFeatureDefinitionsForLLM({
        categories: parsed.categories,
        features: parsed.features
      });
    } else {
      setFeatureDefinitionsForLLM({ categories: [], features: {} });
    }
  };

  // Handle LLM cell click to show annotations for specific provider/category
  const handleLLMCellClick = (lineNumber: number, provider: string, category: string, event: React.MouseEvent) => {
    const rowData = tableData.find(row => row.col2 === lineNumber);
    if (rowData) {
      // Calculate position based on clicked cell
      const cellElement = event.currentTarget as HTMLElement;
      const rect = cellElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dropdownHeight = 300; // Estimated dropdown height
      const dropdownWidth = 320; // Estimated dropdown width

      // Check vertical space
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Check horizontal space
      const spaceRight = viewportWidth - rect.right;
      const spaceLeft = rect.left;

      // Determine best position
      let dropdownPosition: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
      let x: number;
      let y: number;

      if (spaceBelow >= dropdownHeight) {
        dropdownPosition = 'bottom';
        x = rect.left + rect.width / 2;
        y = rect.bottom;
      } else if (spaceAbove >= dropdownHeight) {
        dropdownPosition = 'top';
        x = rect.left + rect.width / 2;
        y = rect.top;
      } else if (spaceRight >= dropdownWidth) {
        dropdownPosition = 'right';
        x = rect.right;
        y = rect.top;
      } else if (spaceLeft >= dropdownWidth) {
        dropdownPosition = 'left';
        x = rect.left;
        y = rect.top;
      } else {
        // Default fallback
        dropdownPosition = 'bottom';
        x = rect.left + rect.width / 2;
        y = rect.bottom;
      }

      setShowLLMCellPopup({
        lineNumber,
        provider,
        category,
        rowData,
        position: { x, y },
        dropdownPosition
      });
    }
  };

  // Get annotation data for a specific line, provider, and category
  const getLLMAnnotationsForLineAndCategory = (lineNumber: number, provider: string, category: string) => {
    if (!separateLlmAnnotationData?.[provider]?.[category]) return {};
    
    const lineIndex = lineNumber - 1;
    const categoryData = separateLlmAnnotationData[provider][category];
    const lineAnnotations = categoryData.annotations[lineIndex] || {};
    const codes = categoryData.codes || [];
    
    const annotations: { [code: string]: boolean | number } = {};
    codes.forEach(code => {
      annotations[code] = lineAnnotations[code] || false;
    });
    
    return annotations;
  };

  // Get feature definition for a specific code in provider data
  const getLLMCodeDefinition = (provider: string, category: string, code: string) => {
    if (!separateLlmAnnotationData?.[provider]?.[category]?.definitions) return null;
    const def = separateLlmAnnotationData[provider][category].definitions[code];
    if (!def) return null;
    
    return {
      code,
      definition: def.Definition || '',
      example1: def.example1 || '',
      example2: def.example2 || '',
      nonexample1: def.nonexample1 || '',
      nonexample2: def.nonexample2 || ''
    };
  };

  if (!mounted) {
    console.log("Component not mounted yet, showing loading screen. Loading:", loading, "Mounted:", mounted);
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4 text-black">Loading Transcript...</h1>
          <div className="animate-pulse text-gray-500">Please wait...</div>
              </div>
            </div>
    );
  }

  console.log("Component is mounted, rendering main UI. TableData length:", tableData.length);

  // Show LLM comparison view if requested
  if (showLLMComparison) {
    return (
      <LLMComparisonView 
        number={number}
        tableData={tableData}
        humanAnnotations={annotationData}
        llmAnnotations={llmAnnotationData}
        onBack={() => setShowLLMComparison(false)}
        speakerColors={speakerColors}
        whichSegment={whichSegment}
        hasSelectableColumn={hasSelectableColumn}
      />
    );
  }

  // Show LLM Analysis comparison view if requested
  if (showLLMAnalysisComparison) {
    return (
      <LLMAnalysisComparisonView 
        number={number}
        tableData={tableData}
        userNotes={notes}
        llmAnalysisData={llmAnalysisData}
        onBack={() => setShowLLMAnalysisComparison(false)}
        speakerColors={speakerColors}
        whichSegment={whichSegment}
      />
    );
  }

  // Show Experts comparison view if requested
  if (showExpertsComparison) {
    return (
      <ExpertsComparisonView 
        number={number}
        tableData={tableData}
        userNotes={notes}
        expertsData={expertsAnnotationData}
        onBack={() => setShowExpertsComparison(false)}
        speakerColors={speakerColors}
        whichSegment={whichSegment}
      />
    );
  }

  // Show Unified comparison view if requested
  if (showUnifiedComparison) {
    return (
      <UnifiedComparisonView 
        number={number}
        tableData={tableData}
        userNotes={notes}
        expertsData={expertsAnnotationData}
        llmAnalysisData={llmAnalysisData}
        onBack={() => setShowUnifiedComparison(false)}
        speakerColors={speakerColors}
        whichSegment={whichSegment}
      />
    );
  }

  // Show Multi-Annotator comparison view if requested
  if (showMultiAnnotatorComparison) {
    return (
                <MultiAnnotatorComparisonView
            tableData={tableData}
            currentAnnotatorData={annotationData}
            onBack={() => setShowMultiAnnotatorComparison(false)}
            speakerColors={speakerColors}
            notes={notes}
            getNoteDisplayText={getNoteDisplayText}
            hasSelectableColumn={hasSelectableColumn}
          />
    );
  }

  return (
    <div className="flex flex-col items-center min-h-screen w-full bg-white font-merriweather text-sm">
      {/* Navigation button - fixed in top left corner */}
      <button
        onClick={async () => {
          // Only save data if real data has been loaded
          if (dataLoaded && tableData.length > 0) {
            console.log('Saving data before navigating home...');
            try {
              const dataToSave = { 
                tableData, 
                notes, 
                nextNoteId, 
                availableIds,
                hasSegmentColumn,
                hasSelectableColumn,
                extraColumns,
                extraColumnVisibility
              };
              
              await safeStorageSet(`tableData-${number}`, JSON.stringify(dataToSave));
              
              if (annotationData) {
                await safeStorageSet(`annotations-${number}`, JSON.stringify(annotationData));
              }
              
              if (notes && notes.length > 0) {
                await safeStorageSet(`notes-${number}`, JSON.stringify(notes));
              }
              
              console.log('Data saved successfully before navigation');
            } catch (error) {
              console.error('Error saving data before navigation:', error);
            }
          } else {
            console.log('No real data loaded, skipping save before navigation to prevent overwriting good data');
          }
          
          router.push("/");
        }}
        className="fixed top-4 left-4 z-50 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors shadow-lg flex items-center gap-2"
        title="Back to Transcript Selection"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
        Home
      </button>
      
      {/* Storage Warning Banner */}
      {storageWarning && (
        <div className="w-full max-w-6xl p-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-yellow-800">Storage Warning</h3>
                <p className="text-sm text-yellow-700 mt-1">{storageWarning}</p>
              </div>
              <button
                onClick={() => setStorageWarning(null)}
                className="flex-shrink-0 text-yellow-400 hover:text-yellow-600"
                title="Dismiss warning"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Header area with title */}
      <div className="w-full max-w-6xl p-4 mb-4">
        
        <div className="bg-gray-100 border rounded-lg p-4 mb-4">
          <div className="flex justify-between items-start mb-3">
            {/* Editable Title */}
            <div className="flex-1 mr-4">
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    className="flex-1 text-xl text-gray-800 font-semibold bg-white border border-gray-300 rounded px-2 py-1"
                    placeholder="Enter title..."
                    autoFocus
                  />
                  <button
                    onClick={saveTitle}
                    className="px-2 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEditingTitle}
                    className="px-2 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h1 
                  className="text-xl text-gray-800 font-semibold cursor-pointer hover:bg-gray-200 p-1 rounded"
                  onClick={startEditingTitle}
                  title="Click to edit title"
                >
                  {title || "Click to add title"}
                </h1>
              )}
            </div>
            
            <button
              onClick={() => setShowInstruction(!showInstruction)}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-md transition-colors flex items-center gap-1"
              title={showInstruction ? "Hide lesson details" : "Show lesson details"}
            >
              {showInstruction ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/>
                  </svg>
                  Hide
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                  </svg>
                  Show
                </>
            )}
            </button>
        </div>
          
          {showInstruction && (
            <>
                              {/* Editable Instruction and Context */}
              <div>
                <h2 className="text-lg text-gray-800 font-medium mb-2">Instruction and Context:</h2>
                {isEditingInstruction ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={tempInstruction}
                      onChange={(e) => setTempInstruction(e.target.value)}
                      className="w-full text-gray-700 leading-relaxed bg-white border border-gray-300 rounded px-3 py-2 min-h-[100px]"
                                              placeholder="Enter instruction and context..."
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveInstruction}
                        className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditingInstruction}
                        className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p 
                    className="text-gray-700 leading-relaxed whitespace-pre-line cursor-pointer hover:bg-gray-200 p-2 rounded"
                    onClick={startEditingInstruction}
                                            title="Click to edit instruction and context"
                  >
                                          {instruction || "Click to add instruction and context"}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-semibold text-gray-800 text-center">Filter by lesson segment or speaker</h2>
      </div>
      <div className="flex gap-2">
        {/* Segment Filter Dropdown */}
        <div className="relative inline-block" data-dropdown="segment">
          <button
            onClick={() => setShowSegmentDropdown(!showSegmentDropdown)}
            className={`px-3 py-1 rounded-md text-sm text-white flex items-center gap-1 ${
              whichSegment !== 'full_transcript' ? 'bg-blue-500 hover:bg-blue-700' : 'bg-gray-400 hover:bg-gray-500'
            }`}
          >
            {whichSegment === 'full_transcript' ? 'All Segments' : whichSegment}
            <svg className={`w-4 h-4 transition-transform ${showSegmentDropdown ? 'rotate-180' : ''}`} 
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSegmentDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]">
              <div className="py-1">
                <button
                  onClick={() => {
                    handleSegmentClick('full_transcript');
                    setShowSegmentDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                    whichSegment === 'full_transcript' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  📝 All Segments
                </button>
                
                {/* Individual Segment Options */}
                {availableSegment.length > 0 && (
                  <>
                    <div className="border-t border-gray-200 my-1"></div>
                    <div className="px-3 py-1 text-xs text-gray-500 font-medium">Individual Segments:</div>
                    {availableSegment.map(segment => (
                      <button
                        key={segment}
                        onClick={() => {
                          handleSegmentClick(segment);
                          setShowSegmentDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                          whichSegment === segment ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        📋 {segment}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Speaker Filter Dropdown */}
        <div className="relative inline-block" data-dropdown="speaker">
          <button
            onClick={() => setShowSpeakerDropdown(!showSpeakerDropdown)}
            className={`px-3 py-1 rounded-md text-sm text-white flex items-center gap-1 ${
              speakerFilter !== 'full_transcript' ? 'bg-green-500 hover:bg-green-700' : 'bg-gray-400 hover:bg-gray-500'
            }`}
          >
            {speakerFilter === 'full_transcript' ? 'All Speakers' : 
             speakerFilter === 'student_only' ? 'Students Only' :
             speakerFilter === 'teacher_only' ? 'Teachers Only' :
             speakerFilter}
            <svg className={`w-4 h-4 transition-transform ${showSpeakerDropdown ? 'rotate-180' : ''}`} 
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSpeakerDropdown && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]">
              <div className="py-1">
                <button
                  onClick={() => {
                    setSpeakerFilter('full_transcript');
                    setShowSpeakerDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                    speakerFilter === 'full_transcript' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  🔊 All Speakers
                </button>
                
                <button
                  onClick={() => {
                    setSpeakerFilter('student_only');
                    setShowSpeakerDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                    speakerFilter === 'student_only' ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  🎓 Students Only
                </button>
                
                <button
                  onClick={() => {
                    setSpeakerFilter('teacher_only');
                    setShowSpeakerDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                    speakerFilter === 'teacher_only' ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  👨‍🏫 Teachers Only
                </button>
                
                {/* Individual Speaker Options */}
                {Object.keys(speakerColors).length > 0 && (
                  <>
                    <div className="border-t border-gray-200 my-1"></div>
                    <div className="px-3 py-1 text-xs text-gray-500 font-medium">Individual Speakers:</div>
                    {Object.keys(speakerColors).map(speaker => (
                      <button
                        key={speaker}
                        onClick={() => {
                          setSpeakerFilter(speaker);
                          setShowSpeakerDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2 ${
                          speakerFilter === speaker ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <div 
                          className="w-3 h-3 rounded-full border border-gray-300"
                          style={{ backgroundColor: speakerColors[speaker] }}
                        ></div>
                        {speaker}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main 3-panel layout */}
        <div className="flex w-full h-[calc(100vh-200px)] mb-4 relative">
          {/* Left Panel - Prompt and Grade Level */}
          <div className={`p-4 flex flex-col overflow-y-auto border-r border-gray-300 transition-all duration-300 ${showPromptPanel ? '' : 'w-0 p-0 overflow-hidden'}`} style={{ width: showPromptPanel ? leftPanelWidth : '0' }}>
            <div className="bg-gray-100 border rounded-lg shadow-md p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-xl font-semibold text-gray-800">Instructional Materials</h2>
                <button
                  onClick={() => setShowPromptPanel(false)}
                  className="px-2 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded-md"
                >
                  Hide
                </button>
              </div>
              <Tab1 number={number} selectedSegment={whichSegment} />
            </div>
          </div>
        
        {/* Left Resize Handle */}
        <div 
          className={`${showPromptPanel ? 'w-1 bg-gray-300 hover:bg-blue-500 hover:w-2 cursor-col-resize z-10 transition-colors' : 'w-0'}`}
          onMouseDown={() => setIsDraggingLeft(true)}
        ></div>

        {/* Center Panel - Transcript Table */}
        <div className="p-4 flex flex-col" style={{ 
          width: showPromptPanel ? centerPanelWidth : '100%'
        }}>
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {!showPromptPanel && (
                  <button
                    onClick={() => setShowPromptPanel(true)}
                    className="px-3 py-1 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded-md"
                  >
                    Show Prompts
                  </button>
                )}
            <h2 className="text-xl font-semibold text-gray-800 text-center">
              {title && title !== "Title..." ? title : "Transcript"}
            </h2>
              </div>
              
              <div className="flex items-center gap-2">
            {isCreatingNote ? (
              <div className="border border-gray-300 rounded-md bg-gray-100 p-4 my-3 max-w-md">
                <span className="mr-2 text-sm text-black italic">Select rows that provide <b className="font-bold">sufficient evidence</b> to allow you to assess and/or advance their understanding toward the lesson goals. </span>
                <button
                  onClick={handleCreateNote}
                  disabled={selectedRows.length === 0}
                  className={`px-2 py-1 rounded text-xs mr-1 ${
                    selectedRows.length === 0
                      ? "bg-gray-300 text-gray-500"
                      : "bg-green-500 text-white"
                  }`}
                >
                  Create
                </button>
                <button
                  onClick={cancelNoteCreation}
                  className="px-2 py-1 rounded text-xs bg-red-500 text-white"
                >
                  Cancel
                </button>
              </div>
            ) : editingLinesId !== null ? (
              <div className="flex items-center">
                <span className="mr-2 text-sm">Editing lines for learning goal note #{editingLinesId}</span>
                <button
                  onClick={() => saveLinesEdit(editingLinesId)}
                  className="px-2 py-1 rounded text-xs mr-1 bg-green-500 text-white"
                >
                  Save
                </button>
                <button
                  onClick={cancelLinesEdit}
                  className="px-2 py-1 rounded text-xs bg-red-500 text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLLMAnnotationModal(true)}
                  className="px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm"
                >
                  Annotate with LLM
                </button>
                <button
                  onClick={() => setShowMultiAnnotatorComparison(true)}
                  className="px-3 py-1 bg-orange-500 text-white rounded-md hover:bg-orange-700 text-sm"
                >
                  Compare with Other Annotators
                </button>
              </div>
            )}
              </div>
          </div>

            {/* Split into two rows: column toggles and feature buttons */}
            <div className="flex justify-between items-center">
              {/* Hidden Columns Dropdown on the left */}
              <div className="relative">
                {(() => {
                  // Check if there are any hidden columns
                  const hiddenCoreColumns = [
                    { key: 'segment', label: 'Segment', condition: hasSegmentColumn && !columnVisibility.segment },
                    { key: 'lineNumber', label: 'Line #', condition: !columnVisibility.lineNumber },
                    { key: 'start', label: 'Start Time', condition: !columnVisibility.start },
                    { key: 'end', label: 'End Time', condition: !columnVisibility.end },
                    { key: 'speaker', label: 'Speaker', condition: !columnVisibility.speaker },
                    { key: 'utterance', label: 'Utterance', condition: !columnVisibility.utterance }
                  ].filter(col => col.condition);

                  const hiddenExtraColumns = extraColumns.filter(colName => !extraColumnVisibility[colName]);
                  const hasHiddenColumns = hiddenCoreColumns.length > 0 || hiddenExtraColumns.length > 0;

                  if (!hasHiddenColumns) return null;

                  return (
                    <>
                      <button
                        onClick={() => setShowHiddenColumnsDropdown(!showHiddenColumnsDropdown)}
                        className="px-3 py-1 rounded-md text-sm bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-1"
                      >
                        Hidden Columns
                        <svg 
                          className={`w-4 h-4 transition-transform ${showHiddenColumnsDropdown ? 'rotate-180' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {showHiddenColumnsDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 min-w-[200px]">
                          <div className="py-1">
                            {/* Core columns */}
                            {hiddenCoreColumns.map(col => (
                              <button
                                key={col.key}
                                onClick={() => {
                                  toggleColumnVisibility(col.key as keyof typeof columnVisibility);
                                  setShowHiddenColumnsDropdown(false);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                              >
                                Show {col.label}
                              </button>
                            ))}
                            
                            {/* Extra columns */}
                            {hiddenExtraColumns.map(colName => (
                              <button
                                key={colName}
                                onClick={() => {
                                  toggleExtraColumnVisibility(colName);
                                  setShowHiddenColumnsDropdown(false);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                              >
                                Show {colName}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Feature buttons on the right */}
              <div className="flex gap-2">
                <div className="text-sm text-gray-600 italic">
                  Click on feature columns to see code definitions
                </div>
              </div>
            </div>

            {/* Search Box */}
            <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-200">
              <span className="text-sm text-gray-600">Search:</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search utterances or enter line number..."
                  className="px-3 py-1 border border-gray-300 rounded text-sm w-80"
                />
                {searchMatches.length > 0 && (
                  <>
                    <span className="text-sm text-gray-600">
                      {currentSearchMatch + 1} of {searchMatches.length}
                    </span>
                  <button
                      onClick={() => navigateSearch('prev')}
                      className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                      title="Previous match"
                    >
                      ↑
              </button>
                <button
                      onClick={() => navigateSearch('next')}
                      className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                      title="Next match"
                    >
                      ↓
                </button>
                  </>
                )}
                {searchTerm && (
                  <button
                    onClick={clearSearch}
                    className="px-2 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-4 flex-grow">Loading transcript data...</div>
          ) : error ? (
            <div className="text-center py-4 text-red-500 flex-grow">{error}</div>
          ) : (
            <div className="overflow-y-auto flex-grow border">
              <table className="min-w-full table-auto border-collapse w-full border-2 border-black">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    {/* Checkbox column in header */}
                    {(isCreatingNote || editingLinesId !== null) && (
                      <th className="w-12 px-2 py-2 border border-black border-2 text-center">
                      </th>
                    )}

                    {/* Segment Column */}
                    {hasSegmentColumn && columnVisibility.segment && (
                      <th className={`px-2 py-2 border border-black border-2 text-black text-sm ${columnVisibility.segment ? 'w-24' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.segment}
                            onChange={() => toggleColumnVisibility('segment')}
                            className="mr-1"
                          />
                          Segment
                        </label>
                      </th>
                    )}

                    {/* Line Number Column */}
                    {columnVisibility.lineNumber && (
                      <th className={`px-2 py-2 border border-black border-2 text-black text-sm ${columnVisibility.lineNumber ? 'w-16' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.lineNumber}
                            onChange={() => toggleColumnVisibility('lineNumber')}
                            className="mr-1"
                          />
                          Line #
                        </label>
                      </th>
                    )}
                  
                    {/* Start Timestamp Column */}
                    {columnVisibility.start && (
                      <th className={`px-2 py-2 border border-black border-2  text-black text-sm ${columnVisibility.start ? 'w-24' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.start}
                            onChange={() => toggleColumnVisibility('start')}
                            className="mr-1"
                          />
                          Start timestamp
                        </label>
                      </th>
                    )}

                    {/* End Timestamp Column */}
                    {columnVisibility.end && (
                      <th className={`px-2 py-2 border border-black border-2 text-black text-sm ${columnVisibility.end ? 'w-24' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.end}
                            onChange={() => toggleColumnVisibility('end')}
                            className="mr-1"
                          />
                          End timestamp
                        </label>
                      </th>
                    )}

                    {/* Speaker Column */}
                    {columnVisibility.speaker && (
                      <th className={`px-2 py-2 border border-black border-2  text-black text-sm ${columnVisibility.speaker ? 'w-32' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.speaker}
                            onChange={() => toggleColumnVisibility('speaker')}
                            className="mr-1"
                          />
                          Speaker
                        </label>
                      </th>
                    )}
                    
                    {/* Utterance Column */}
                    {columnVisibility.utterance && (
                      <th className={`px-2 py-2 border border-black border-2 text-black text-sm ${columnVisibility.utterance ? 'w-auto' : 'w-12'}`}>
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={columnVisibility.utterance}
                            onChange={() => toggleColumnVisibility('utterance')}
                            className="mr-1"
                          />
                          Utterance
                        </label>
                      </th>
                    )}
                    

                    {/* Notes Column */}
                    {showNotesColumn && (
                      <th className={`px-2 py-2 border border-black border-2 text-sm ${columnVisibility.notes ? 'w-24' : 'w-12'}`}>
                          <button
                            onClick={() => setShowPromptPopup(true)}
                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-sm font-medium"
                            title="Click to view annotation prompt"
                          >
                            Notes
                          </button>
                      </th>
                    )}

                    {/* Feature Columns */}
                    {annotationData && Object.keys(annotationData).map(category => {
                      return (
                        <th 
                          key={category} 
                          className="px-2 py-2 border border-black border-2 text-sm w-20 text-center cursor-pointer hover:bg-blue-50 relative group"
                          onClick={() => setShowFeatureOverview(category)}
                        >
                          <div className="text-sky-600 font-medium hover:text-sky-800">
                            {category}
                          </div>
                          
                          {/* Custom Hover Tooltip */}
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-96 bg-white border-2 border-gray-800 rounded-lg shadow-lg p-4 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none max-h-80 overflow-y-auto">
                            <h3 className="text-lg font-bold text-gray-800 mb-3 text-center">{category} Features</h3>
                            <div className="space-y-3 text-left">
                              {annotationData[category] && annotationData[category].codes && Array.isArray(annotationData[category].codes) ? 
                                annotationData[category].codes.map((code: string) => {
                                  const definition = annotationData[category].definitions[code];
                                  return (
                                    <div key={code} className="border-b border-gray-200 pb-2 last:border-b-0">
                                      <h4 className="text-sm font-semibold text-blue-700 mb-1">{code}</h4>
                                      
                                      {definition && (
                                        <>
                                          {definition.Definition && (
                                            <div className="mb-2">
                                              <span className="text-xs font-medium text-gray-800">Definition:</span>
                                              <p className="text-xs text-gray-700 mt-1">{definition.Definition}</p>
                                            </div>
                                          )}
                                          
                                          {definition.example1 && (
                                            <div className="mb-2">
                                              <span className="text-xs font-medium text-green-800">Example:</span>
                                              <p className="text-xs text-green-700 italic mt-1">{definition.example1}</p>
                                            </div>
                                          )}
                                          
                                          {definition.example2 && (
                                            <div className="mb-2">
                                              <span className="text-xs font-medium text-green-800">Example 2:</span>
                                              <p className="text-xs text-green-700 italic mt-1">{definition.example2}</p>
                                            </div>
                                          )}
                                          
                                          {definition.nonexample1 && (
                                            <div className="mb-2">
                                              <span className="text-xs font-medium text-red-800">Non-example:</span>
                                              <p className="text-xs text-red-700 italic mt-1">{definition.nonexample1}</p>
                                            </div>
                                          )}
                                          
                                          {definition.nonexample2 && (
                                            <div className="mb-2">
                                              <span className="text-xs font-medium text-red-800">Non-example 2:</span>
                                              <p className="text-xs text-red-700 italic mt-1">{definition.nonexample2}</p>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                }) : (
                                  <div className="text-center text-gray-500 py-4 text-xs">
                                    <p>No feature codes available for this category.</p>
                                  </div>
                                )}
                            </div>
                            <div className="text-center mt-3 pt-2 border-t border-gray-200">
                              <p className="text-xs text-gray-500">Click header to open detailed view</p>
                            </div>
                          </div>
                        </th>
                      );
                    })}

                    {/* LLM Feature Columns */}
                    {separateLlmAnnotationData && Object.entries(separateLlmAnnotationData).map(([provider, providerData]) => 
                      Object.keys(providerData).map(category => (
                        <th 
                          key={`llm-${provider}-${category}`} 
                          className={`px-2 py-2 border border-black border-2 text-sm w-20 text-center ${
                            provider.includes('ChatGPT') ? 'bg-green-50' : 'bg-purple-50'
                          }`}
                          title={`${provider} annotations for ${category} features (read-only)`}
                        >
                          <div className={`font-medium text-xs ${
                            provider.includes('ChatGPT') ? 'text-green-600' : 'text-purple-600'
                          }`}>
                            {provider}<br/>{category}
                          </div>
                        </th>
                      ))
                    )}

                    {/* Extra Columns */}
                    {extraColumns.map(colName => 
                      extraColumnVisibility[colName] && (
                        <th 
                          key={colName}
                          className="px-2 py-2 border border-black border-2 text-black text-sm w-24"
                        >
                          <label className="flex items-center">
                            <input
                              type="checkbox"
                              checked={extraColumnVisibility[colName]}
                              onChange={() => toggleExtraColumnVisibility(colName)}
                              className="mr-1"
                            />
                            {colName}
                          </label>
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredTableData.map((rowData, index) => (
                    <TableRow
                      key={`${rowData.col2}-${index}`}
                      rowData={rowData}
                      rowIndex={index}
                      annotationData={annotationData}
                      separateLlmAnnotationData={separateLlmAnnotationData}
                      onFeatureChange={handleFeatureChange}
                      speakerColors={speakerColors}
                      columnVisibility={columnVisibility}
                      showNotesColumn={showNotesColumn}
                      isCreatingNote={isCreatingNote}
                      editingLinesId={editingLinesId}
                      selectedRows={selectedRows}
                      tempSelectedRows={tempSelectedRows}
                      toggleRowSelection={toggleRowSelection}
                      toggleTempRowSelection={toggleTempRowSelection}
                      getNoteDisplayText={getNoteDisplayText}
                      hasSegmentColumn={hasSegmentColumn}
                      extraColumns={extraColumns}
                      extraColumnVisibility={extraColumnVisibility}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right panel removed - all notes functionality moved to popup */}
            </div>
      
      {/* Footer area with buttons */}
      <div className="w-full max-w-6xl p-4 flex flex-col items-center">
        <div className="flex justify-center items-center space-x-8">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-500 text-white font-semibold rounded-md hover:bg-blue-700 transition"
            >
              Save
            </button>
            

          </div>
          




          <button
            onClick={handleExport}
            className="px-6 py-2 bg-green-500 text-white font-semibold rounded-md hover:bg-green-700 transition"
          >
            Export to Excel
          </button>

          <button
            onClick={handleUploadToCloud}
            disabled={uploadStatus === 'uploading'}
            className={`px-6 py-2 font-semibold rounded-md transition flex items-center space-x-2 ${
              uploadStatus === 'uploading'
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : uploadStatus === 'success'
                ? 'bg-green-600 text-white'
                : uploadStatus === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-blue-500 text-white hover:bg-blue-700'
            }`}
          >
            {uploadStatus === 'uploading' && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            <span>
              {uploadStatus === 'uploading'
                ? 'Uploading...'
                : uploadStatus === 'success'
                ? 'Uploaded!'
                : uploadStatus === 'error'
                ? 'Upload Failed'
                : 'Upload to Cloud'}
            </span>
          </button>
        </div>
      </div>

      {selectedFeaturePopup && selectedFeaturePopup.definition && (
        <FeaturePopup
          code={selectedFeaturePopup.code}
          definition={selectedFeaturePopup.definition}
          example1={selectedFeaturePopup.example1}
          nonexample1={selectedFeaturePopup.nonexample1}
          position={selectedFeaturePopup.position}
          onClose={() => setSelectedFeaturePopup(null)}
        />
      )}

      {/* Feature Overview Popup */}
      {showFeatureOverview && annotationData?.[showFeatureOverview] && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowFeatureOverview(null)}
        >
          <div 
            className="bg-white border-2 border-gray-800 rounded-lg shadow-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-800">
                {showFeatureOverview} Features & Definitions
              </h2>
              <button
                onClick={() => setShowFeatureOverview(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                title="Close"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              {annotationData && annotationData[showFeatureOverview] && annotationData[showFeatureOverview].codes && Array.isArray(annotationData[showFeatureOverview].codes) ? 
                annotationData[showFeatureOverview].codes.map((code: string) => {
                const definition = annotationData[showFeatureOverview].definitions[code];
                return (
                  <div key={code} className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-blue-700 mb-2">{code}</h3>
                    
                    {definition && (
                      <>
                        <div className="mb-3">
                          <h4 className="font-medium text-gray-800 mb-1">Definition:</h4>
                          <p className="text-gray-700">{definition.Definition || 'No definition available'}</p>
                        </div>
                        
                        {definition.example1 && (
                          <div className="mb-3">
                            <h4 className="font-medium text-green-800 mb-1">Example:</h4>
                            <p className="text-green-700 italic">{definition.example1}</p>
                          </div>
                        )}
                        
                        {definition.example2 && (
                          <div className="mb-3">
                            <h4 className="font-medium text-green-800 mb-1">Example 2:</h4>
                            <p className="text-green-700 italic">{definition.example2}</p>
                          </div>
                        )}
                        
                        {definition.nonexample1 && (
                          <div className="mb-3">
                            <h4 className="font-medium text-red-800 mb-1">Non-example:</h4>
                            <p className="text-red-700 italic">{definition.nonexample1}</p>
                          </div>
                        )}
                        
                        {definition.nonexample2 && (
                          <div className="mb-3">
                            <h4 className="font-medium text-red-800 mb-1">Non-example 2:</h4>
                            <p className="text-red-700 italic">{definition.nonexample2}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
                }) : (
                  <div className="text-center text-gray-500 py-8">
                    <p>No feature codes available for this category.</p>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Note Content Popup */}
      {selectedNotePopup && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedNotePopup(null)}
        >
          <div 
            className="bg-white border-2 border-gray-800 rounded-lg shadow-lg max-w-4xl w-full max-h-[95vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-white rounded-t-lg flex-shrink-0">
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1">
                  <h1 className="text-xl text-gray-800 font-semibold">
                      Learning Goal Note :
                  </h1>
                    <div className="flex-1">
                        <input
                          type="text"
                        value={isNoteInEditMode ? (noteEditBuffer?.title || '') : selectedNotePopup.note.title}
                        onChange={(e) => {
                          const newTitle = e.target.value;
                          
                          // Check for duplicate titles
                          if (checkTitleExists(newTitle, selectedNotePopup.note.id)) {
                            setTitleValidationError('This title already exists. Please choose a different name.');
                          } else {
                            setTitleValidationError('');
                          }
                          
                          if (isNoteInEditMode) {
                            setNoteEditBuffer(prev => prev ? {...prev, title: newTitle} : null);
                          } else {
                            // Update the note directly when not in edit mode
                            const updatedNotes = notes.map(note => 
                              note.id === selectedNotePopup.note.id 
                                ? {...note, title: newTitle}
                                : note
                            );
                            setNotes(updatedNotes);
                            setSelectedNotePopup({
                              ...selectedNotePopup,
                              note: {...selectedNotePopup.note, title: newTitle}
                            });
                          }
                        }}
                        className={`text-xl text-blue-600 font-medium border focus:outline-none bg-white p-1 rounded flex-1 ${
                          titleValidationError 
                            ? 'border-red-500 focus:border-red-500' 
                            : 'border-blue-300 focus:border-blue-500'
                        }`}
                        placeholder="Enter note title..."
                      />
                      {titleValidationError && (
                        <div className="text-red-500 text-xs mt-1">{titleValidationError}</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <p>Lines: {selectedNotePopup.note.rowIndices && Array.isArray(selectedNotePopup.note.rowIndices) && tableData && Array.isArray(tableData) ? 
                    selectedNotePopup.note.rowIndices.map(idx => tableData[idx]?.col2).filter(Boolean).join(', ') : 'N/A'}</p>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this note?')) {
                        handleDeleteNote(selectedNotePopup.note.id);
                        setSelectedNotePopup(null);
                      }
                    }}
                    className="text-red-500 hover:text-red-700"
                    title="Delete this note"
                  >
                    🗑 Delete this Note
                  </button>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex items-center gap-2 ml-4">
                    <button
                  onClick={() => {
                    if (!titleValidationError) {
                      setSelectedNotePopup(null);
                      setTitleValidationError('');
                    }
                  }}
                  disabled={titleValidationError !== ''}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    titleValidationError 
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                  title={titleValidationError ? 'Please fix the title error before saving' : 'Save and close'}
                    >
                  Save & Close
                    </button>
                <button
                  onClick={() => {
                    setSelectedNotePopup(null);
                    setTitleValidationError('');
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl leading-none flex-shrink-0"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="overflow-y-auto flex-1 p-6 space-y-6">
              {/* Evidence */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h3 className="font-semibold text-gray-800 mb-3">Evidence from Transcript:</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {selectedNotePopup.noteRows && Array.isArray(selectedNotePopup.noteRows) ? 
                    selectedNotePopup.noteRows.map((row, rowIdx) => (
                    <div key={rowIdx} className="pb-3 border-b border-gray-200 last:border-b-0">
                      <p className="text-sm text-gray-800 mb-1">{row.col6}</p>
                      <p className="text-xs text-gray-500">Line {row.col2} • {row.col5}</p>
                    </div>
                    )) : (
                      <div className="text-center text-gray-500 py-4">
                        <p>No note rows available</p>
                      </div>
                    )}
                </div>
              </div>

              {/* Question 1 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-3">
                  Q1: What are students saying in the selected piece(s) of evidence?
                </h3>
                  <textarea
                  value={selectedNotePopup.note.content_1 || ''}
                  onChange={(e) => {
                    const updatedNotes = notes.map(note => 
                      note.id === selectedNotePopup.note.id 
                        ? {...note, content_1: e.target.value}
                        : note
                    );
                    setNotes(updatedNotes);
                    setSelectedNotePopup({
                      ...selectedNotePopup,
                      note: {...selectedNotePopup.note, content_1: e.target.value}
                    });
                  }}
                    rows={4}
                    className="w-full p-3 border border-gray-300 rounded focus:border-blue-500 focus:outline-none resize-y text-sm text-gray-800"
                    placeholder="Type your response here..."
                  />
              </div>

              {/* Question 2 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-gray-800 mb-3">
                  Q2: What would you like to note about this utterance?
                </h3>
                  <textarea
                  value={selectedNotePopup.note.content_2 || ''}
                  onChange={(e) => {
                    const updatedNotes = notes.map(note => 
                      note.id === selectedNotePopup.note.id 
                        ? {...note, content_2: e.target.value}
                        : note
                    );
                    setNotes(updatedNotes);
                    setSelectedNotePopup({
                      ...selectedNotePopup,
                      note: {...selectedNotePopup.note, content_2: e.target.value}
                    });
                  }}
                    rows={5}
                    className="w-full p-3 border border-gray-300 rounded focus:border-blue-500 focus:outline-none resize-y text-sm text-gray-800"
                    placeholder="Type your response here..."
                  />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Popup */}
      {showPromptPopup && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4"
          onClick={() => setShowPromptPopup(false)}
        >
          <div 
            className="bg-white border-2 border-gray-800 rounded-lg shadow-lg max-w-4xl w-full max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col mt-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-white rounded-t-lg flex-shrink-0">
              <h1 className="text-2xl text-gray-800 font-semibold">
                Prompt:
              </h1>
              <button
                onClick={() => setShowPromptPopup(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none flex-shrink-0"
                title="Close"
              >
                ×
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="overflow-y-auto flex-1 p-6">
              <h2 className="text-xl text-gray-800">
                <div>
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <strong>Note:</strong> Only focal student dialogue where the teacher is not present is eligible
                  </div>
                  Consider the goals for this lesson. What do you notice about what students say that would help you{" "}
                  <strong>assess and/or advance</strong> their understanding toward those goals?<i>
                  (Select rows that provide sufficient evidence to allow you to{" "}
                  <strong>assess and/or advance</strong> their understanding toward the lesson goals.)</i>
                  <br /> <br></br>
                  In your notes, please answer the following two questions:<br />
                  1. What are students saying in the selected piece(s) of evidence?<br />
                  2. What does this piece of evidence(s) tell you about students' understanding and/or progress toward the lesson's goals?
                </div>
              </h2>
            </div>
          </div>
        </div>
      )}

      {learningGoalNotePopup && (
        <div 
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-4 learning-goal-popup"
          style={{
            left: learningGoalNotePopup.position.x,
            top: learningGoalNotePopup.position.y,
            minWidth: '250px',
            maxHeight: '300px'
          }}
        >
          {learningGoalNotePopup.mode === 'initial' && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  handleCreateNoteWithRows([learningGoalNotePopup.rowIndex]);
                  setLearningGoalNotePopup(null);
                }}
                className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-2"
              >
                <span>+</span>
                <span>Create New Note</span>
              </button>
              
              {notes.length > 0 && (
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <div className="text-sm font-medium text-gray-700 mb-2">Assign to Existing Note:</div>
                  <div className="max-h-48 overflow-y-auto">
                    {notes.map(note => {
                      const rowIndex = learningGoalNotePopup.rowIndex;
                      const isAssigned = note.rowIndices.includes(rowIndex);
                      
                      return (
                        <div 
                          key={note.id}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => {
                            const updatedNotes = [...notes];
                            const noteIndex = updatedNotes.findIndex(n => n.id === note.id);
                            if (noteIndex !== -1) {
                              if (isAssigned) {
                                // Remove from note
                                updatedNotes[noteIndex].rowIndices = updatedNotes[noteIndex].rowIndices.filter(idx => idx !== rowIndex);
                                
                                // Update table data
                                const updatedTableData = [...tableData];
                                const currentIds = parseNoteIds(updatedTableData[rowIndex].noteIds);
                                updatedTableData[rowIndex].noteIds = currentIds.filter(id => id !== note.id).join(', ');
                                setTableData(updatedTableData);
                              } else {
                                // Add to note
                                updatedNotes[noteIndex].rowIndices.push(rowIndex);
                                
                                // Update table data
                                const updatedTableData = [...tableData];
                                const currentIds = parseNoteIds(updatedTableData[rowIndex].noteIds);
                                updatedTableData[rowIndex].noteIds = [...currentIds, note.id].join(', ');
                                setTableData(updatedTableData);
                              }
                              setNotes(updatedNotes);
                            }
                          }}
                        >
                          <div className={`w-4 h-4 rounded border ${isAssigned ? 'bg-blue-500 border-blue-500' : 'border-gray-300'} flex items-center justify-center`}>
                            {isAssigned && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-gray-700 flex-1">{note.title || `Note ${note.id}`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              <button
                onClick={() => setLearningGoalNotePopup(null)}
                className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 mt-2"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* LLM Cell Popup - Shows specific category annotations for a line */}
      {showLLMCellPopup && (
        <>
          {/* Backdrop to close popup */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setShowLLMCellPopup(null)}
          />
          
          {/* Popup positioned next to clicked cell */}
          <div 
            className={`fixed bg-white border-2 border-gray-800 rounded-lg shadow-lg z-50 min-w-64 p-3 ${
              showLLMCellPopup.dropdownPosition === 'top' ? 'mb-1' :
              showLLMCellPopup.dropdownPosition === 'right' ? 'ml-1' :
              showLLMCellPopup.dropdownPosition === 'left' ? 'mr-1' :
              'mt-1'
            }`}
            style={{
              left: showLLMCellPopup.dropdownPosition === 'top' || showLLMCellPopup.dropdownPosition === 'bottom' 
                ? showLLMCellPopup.position.x - 128 // Center the popup (min-w-64 = 256px, so 128px to center)
                : showLLMCellPopup.dropdownPosition === 'left' 
                  ? showLLMCellPopup.position.x - 256 // Position to the left
                  : showLLMCellPopup.position.x, // Position to the right
              top: showLLMCellPopup.dropdownPosition === 'top'
                ? showLLMCellPopup.position.y - 300 // Position above
                : showLLMCellPopup.position.y, // Position below or at same level
            }}
            onClick={(e) => e.stopPropagation()}
            data-llm-popup="true"
          >
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold text-gray-800">
                {showLLMCellPopup.category} Features
              </div>
              <button
                onClick={() => setShowLLMCellPopup(null)}
                className="text-gray-500 hover:text-gray-700 text-lg leading-none"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(() => {
                const annotations = getLLMAnnotationsForLineAndCategory(
                  showLLMCellPopup.lineNumber, 
                  showLLMCellPopup.provider, 
                  showLLMCellPopup.category
                );
                
                if (Object.keys(annotations).length === 0) {
                  return (
                    <div className="text-center text-gray-500 py-4">
                      <p>No feature codes available</p>
                    </div>
                  );
                }
                
                return Object.entries(annotations).map(([code, value]) => {
                  const isActive = typeof value === 'boolean' ? value : (typeof value === 'number' ? value > 0 : false);
                  
                  return (
                    <div key={code} className="flex items-center justify-between text-xs cursor-pointer hover:bg-gray-50 p-1 rounded">
                      <div className="flex items-center flex-1">
                        <input
                          type="checkbox"
                          checked={isActive}
                          readOnly
                          className="mr-2 form-checkbox h-3 w-3 text-blue-600 cursor-not-allowed"
                          disabled
                        />
                        <button
                          className="text-sky-600 hover:text-sky-800 hover:underline text-left flex-1"
                          onClick={(e) => {
                            const fullDef = getLLMCodeDefinition(showLLMCellPopup.provider, showLLMCellPopup.category, code);
                            if (fullDef) {
                              alert(`${fullDef.code}: ${fullDef.definition}`);
                            }
                            e.stopPropagation();
                          }}
                          title="Click for definition and examples"
                        >
                          {code}
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}

      {/* LLM Annotation Modal */}
      {showLLMAnnotationModal && (
        <LLMAnnotationModal
          isOpen={showLLMAnnotationModal}
          onClose={() => setShowLLMAnnotationModal(false)}
          onAnnotationComplete={handleLLMAnnotationComplete}
          transcriptId={number}
          transcriptData={getTranscriptDataForLLM()}
          featureDefinitions={featureDefinitionsForLLM}
        />
      )}

      {/* Annotation Window Modal */}
      {showAnnotationWindow && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-25 flex items-center justify-center z-50"
          onClick={handleCloseAnnotationWindow}
        >
          <div 
            className="bg-white border-2 border-gray-800 rounded-lg shadow-lg p-4 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="text-lg font-semibold text-gray-800">
                {showAnnotationWindow.category} Features
              </div>
              <button
                onClick={handleCloseAnnotationWindow}
                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {showAnnotationWindow.codes && Array.isArray(showAnnotationWindow.codes) ? showAnnotationWindow.codes.map((code: string) => (
                <div key={code} className="flex items-center justify-between">
                  <button
                    className="text-sky-600 hover:text-sky-800 hover:underline text-left mr-3 flex-1 text-sm"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const details = (annotationData?.[showAnnotationWindow.category] && 
                                       annotationData[showAnnotationWindow.category].definitions && 
                                       annotationData[showAnnotationWindow.category].definitions[code]) ? 
                                       annotationData[showAnnotationWindow.category].definitions[code] : null;
                      if (details) {
                        handleOpenDefinition(
                          code,
                          details.Definition || 'No definition available',
                          details.example1 || '',
                          details.nonexample1 || '',
                          {
                            x: rect.left + rect.width / 2,
                            y: rect.bottom + 10
                          }
                        );
                      }
                    }}
                    title="Click for definition and examples"
                  >
                    {code}
                  </button>
                                     <div onClick={(e) => e.stopPropagation()}>
                     <FeatureToggle
                       isChecked={showAnnotationWindow.rowAnnotations[code] || false}
                       isDisabled={!isTableRowSelectable(showAnnotationWindow.rowData)}
                       onToggle={(checked) => {
                         handleFeatureChange(showAnnotationWindow.rowData.col2 - 1, code, checked);
                       }}
                     />
                   </div>
                </div>
              )) : (
                <div className="text-center text-gray-500 py-4">
                  <p>No feature codes available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Definition Popup Modal */}
      {selectedDefinition && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-25 flex items-center justify-center z-50"
          onClick={handleCloseDefinition}
        >
          <div 
            className="bg-blue-50 border-2 border-blue-300 rounded-lg shadow-lg p-4 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <div className="text-lg font-semibold text-blue-800">
                {selectedDefinition.code}
              </div>
              <button
                onClick={handleCloseDefinition}
                className="text-blue-500 hover:text-blue-700 text-xl leading-none"
                title="Close"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="text-sm text-gray-700">
                <strong className="text-blue-800">Definition:</strong>
                <div className="mt-1">{selectedDefinition.definition}</div>
              </div>
              
              {selectedDefinition.example1 && (
                <div className="text-sm text-green-700">
                  <strong className="text-green-800">Example:</strong>
                  <div className="mt-1">{selectedDefinition.example1}</div>
                </div>
              )}
              
              {selectedDefinition.nonexample1 && (
                <div className="text-sm text-red-700">
                  <strong className="text-red-800">Non-example:</strong>
                  <div className="mt-1">{selectedDefinition.nonexample1}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User ID Prompt Modal */}
      {showUserIdPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Upload to Cloud Storage</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter your unique user ID to organize your annotations in cloud storage. This allows for comparison across different annotators.
            </p>
            
            <div className="mb-4">
              <label htmlFor="userId" className="block text-sm font-medium text-gray-700 mb-2">
                User ID <span className="text-red-500">*</span>
              </label>
              <input
                id="userId"
                type="text"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  if (userIdError) setUserIdError('');
                }}
                placeholder="e.g., john_doe_2024"
                className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  userIdError ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              {userIdError && (
                <p className="mt-1 text-xs text-red-600">{userIdError}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                3-20 characters, letters, numbers, hyphens, and underscores only
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowUserIdPrompt(false);
                  setUserId('');
                  setUserIdError('');
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadToCloudWithUserId}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}