import React, { useState, useRef, useEffect } from 'react';
import VideoPlayer from './VideoPlayer';
import Toolbar from './Toolbar';
import '../styles/VideoAnnotator.css';
import JSZip from 'jszip';

// Keypoint configurations
const KEYPOINT_CONFIGS = {
  'avatar': {
    name: 'AVATAR',
    keypoints: [
      'Nose', 'Left Ear', 'Right Ear', 'Thoracic Center', 'Left Forepaw', 'Right Forepaw',
      'Tail Base', 'Left Hindpaw', 'Right Hindpaw', 'Tail Middle', 'Tail Tip', 'Body Center',
    ],
    skeleton: [
      [0, 1], // Nose - Left Ear
      [0, 2], // Nose - Right Ear  
      [2, 3], // Right Ear - Thoracic Center
      [1, 3], // Left Ear - Thoracic Center
      [3, 4], // Thoracic Center - Left Forepaw
      [3, 5], // Thoracic Center - Right Forepaw
      [3, 6], // Thoracic Center - Tail Base
      [6, 7], // Tail Base - Left Hindpaw
      [6, 8], // Tail Base - Right Hindpaw
      [6, 9], // Tail Base - Tail Middle
      [9, 10], // Tail Middle - Tail Tip
    ]
  },
  'mabe22': {
    name: 'MABe22',
    keypoints: [
      'Nose', 'Left Ear', 'Right Ear', 'Base Neck', 'Left Front Paw', 'Right Front Paw',
      'Center Spine', 'Left Rear Paw', 'Right Rear Paw', 'Base Tail', 'Mid Tail', 'Tip Tail',
    ],
    skeleton: [
      [0, 1], // Nose - Left Ear
      [0, 2], // Nose - Right Ear
      [1, 3], // Left Ear - Base Neck
      [2, 3], // Right Ear - Base Neck
      [3, 4], // Base Neck - Left Front Paw
      [3, 5], // Base Neck - Right Front Paw
      [3, 6], // Base Neck - Center Spine
      [6, 9], // Center Spine - Base Tail
      [9, 7], // Base Tail - Left Rear Paw
      [9, 8], // Base Tail - Right Rear Paw
      [9, 10], // Base Tail - Mid Tail
      [10, 11], // Mid Tail - Tip Tail
    ]
  }
};

// Utility functions for multi-animal annotations
// Note: Removed conversion functions - each mode now has completely separate annotation storage
// Single animal mode uses: keypoints, visibilities, bbox, skeletonId, bboxId  
// Multi-animal mode uses: skeletons[], bboxes[]

const VideoAnnotator = ({ darkMode, setDarkMode }) => {
  const [videoFile, setVideoFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [imageUrls, setImageUrls] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentImageName, setCurrentImageName] = useState('');
  // Separate annotation storage for each mode - NO CONVERSION
  const [singleAnimalAnnotations, setSingleAnimalAnnotations] = useState([]);
  const [multiAnimalAnnotations, setMultiAnimalAnnotations] = useState([]);
  const [multiAnimalMode, setMultiAnimalMode] = useState(false);
  
  // Use the appropriate annotations based on current mode
  const annotations = multiAnimalMode ? multiAnimalAnnotations : singleAnimalAnnotations;
  const setAnnotations = multiAnimalMode ? setMultiAnimalAnnotations : setSingleAnimalAnnotations;
  
  const [mode, setMode] = useState(null);
  const [keypointIndex, setKeypointIndex] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [originalFrameIndices, setOriginalFrameIndices] = useState([]);
  const [currentKeypointConfig, setCurrentKeypointConfig] = useState('avatar');
  const [customKeypointConfigs, setCustomKeypointConfigs] = useState({});
  
  // Keypoint configuration state
  const [showKeypointConfigModal, setShowKeypointConfigModal] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [expandedConfigs, setExpandedConfigs] = useState(new Set()); // Track which configs are expanded
  const [hoveredSidebarObject, setHoveredSidebarObject] = useState(null); // {type: 'skeleton'|'bbox', id: number, objKey: string, position: number}
  const [hoveredImageObject, setHoveredImageObject] = useState(null); // {type: 'skeleton'|'bbox', id: number, objKey: string}
  const [selectedImageObjects, setSelectedImageObjects] = useState(new Set()); // Set of objKeys for position-specific selection tracking
  
  // ID Settings state
  const [idSettingsExpanded, setIdSettingsExpanded] = useState(false);
  const [skeletonSectionExpanded, setSkeletonSectionExpanded] = useState(false);
  const [bboxSectionExpanded, setBboxSectionExpanded] = useState(false);
  
  // Current ID state for multi-animal mode
  const [currentSkeletonId, setCurrentSkeletonId] = useState(0);
  const [currentBboxId, setCurrentBboxId] = useState(0);
  
  // Hover state for ID textboxes
  const [hoveredIdTextbox, setHoveredIdTextbox] = useState(null); // {type: 'skeleton'|'bbox', objKey: string}
  
  // Keypoint labels visibility toggle
  const [showKeypointLabels, setShowKeypointLabels] = useState(true);
  
  // Selected keypoints ref
  const selectedKeypoints = useRef(new Set());
  
  // Selection state from VideoPlayer
  const [selectedBbox, setSelectedBbox] = useState(false);
  const [selectedSkeleton, setSelectedSkeleton] = useState(false);
  
  // Multi-animal mode state
  const [showModal, setShowModal] = useState(false);
  const [videoMeta, setVideoMeta] = useState({ fps: 30, duration: 0 });
  const [stride, setStride] = useState(1);
  const [targetFrames, setTargetFrames] = useState(0);
  const [inputMode, setInputMode] = useState('stride'); // 'stride' or 'frames'
  const [randomFrameCount, setRandomFrameCount] = useState(100);
  const [modalView, setModalView] = useState('stride'); // 'stride' or 'random'
  const [pendingVideo, setPendingVideo] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [extractError, setExtractError] = useState('');
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadImageFiles, setLoadImageFiles] = useState([]);
  const [loadLabelFiles, setLoadLabelFiles] = useState([]);
  const [loadImageDirectory, setLoadImageDirectory] = useState('');
  const [loadLabelDirectory, setLoadLabelDirectory] = useState('');
  const [loadError, setLoadError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const hiddenVideoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const videoPlayerRef = useRef(null);
  // Separate undo/redo stacks for each mode
  const [singleAnimalUndoStack, setSingleAnimalUndoStack] = useState([]);
  const [singleAnimalRedoStack, setSingleAnimalRedoStack] = useState([]);
  const [multiAnimalUndoStack, setMultiAnimalUndoStack] = useState([]);
  const [multiAnimalRedoStack, setMultiAnimalRedoStack] = useState([]);
  
  // Keep original single-animal stacks for backward compatibility (UNCHANGED)
  const undoStack = singleAnimalUndoStack;
  const setUndoStack = setSingleAnimalUndoStack; 
  const redoStack = singleAnimalRedoStack;
  const setRedoStack = setSingleAnimalRedoStack;

  // Add state for frame names when video is processed
  const [frameNames, setFrameNames] = useState([]);

  // Sync totalFrames with the number of loaded image URLs
  useEffect(() => {
    setTotalFrames(imageUrls.length);
  }, [imageUrls]);

  // Clear selections and reset states when switching between modes
  useEffect(() => {
    // Reset all selection states when mode changes
    setSelectedBbox(false);
    selectedKeypoints.current.clear();
    setSelectedSkeleton(false);
    setSelectedImageObjects(new Set());
    
    // Reset annotation mode
    setMode(null);
    setKeypointIndex(0);
    
    // Reset current IDs for multi-animal mode
    setCurrentSkeletonId(0);
    setCurrentBboxId(0);
  }, [multiAnimalMode]);

  // Update current IDs when frame changes in multi-animal mode
  useEffect(() => {
    if (multiAnimalMode) {
      updateCurrentIdsForFrame();
    }
  }, [currentFrame, multiAnimalMode, annotations]);

  // Function to calculate next available ID for current frame
  const updateCurrentIdsForFrame = () => {
    if (!multiAnimalMode) return;
    
    const currentAnn = annotations[currentFrame];
    if (!currentAnn) {
      setCurrentSkeletonId(0);
      setCurrentBboxId(0);
      return;
    }
    
    let maxSkeletonId = -1;
    let maxBboxId = -1;
    
    // Check completed skeletons
    if (currentAnn.skeletons) {
      currentAnn.skeletons.forEach(skeleton => {
        if (skeleton.keypoints && skeleton.keypoints.some(pt => pt !== null)) {
          if (skeleton.id !== undefined) {
            maxSkeletonId = Math.max(maxSkeletonId, skeleton.id);
          }
        }
      });
    }
    
    // Check working skeleton
    if (currentAnn.keypoints && currentAnn.keypoints.some(pt => pt !== null)) {
      const id = currentAnn.skeletonId !== undefined ? currentAnn.skeletonId : 0;
      maxSkeletonId = Math.max(maxSkeletonId, id);
    }
    
    // Check completed bboxes
    if (currentAnn.bboxes) {
      currentAnn.bboxes.forEach(bbox => {
        if (bbox.bbox && bbox.bbox.length === 4) {
          if (bbox.id !== undefined) {
            maxBboxId = Math.max(maxBboxId, bbox.id);
          }
        }
      });
    }
    
    // Check working bbox
    if (currentAnn.bbox && currentAnn.bbox.length === 4) {
      const id = currentAnn.bboxId !== undefined ? currentAnn.bboxId : 0;
      maxBboxId = Math.max(maxBboxId, id);
    }
    
    // Set next available IDs (start from 0 if no annotations found)
    const nextSkeletonId = maxSkeletonId >= 0 ? maxSkeletonId + 1 : 0;
    const nextBboxId = maxBboxId >= 0 ? maxBboxId + 1 : 0;
    
    setCurrentSkeletonId(nextSkeletonId);
    setCurrentBboxId(nextBboxId);
  };

  const isVideoMode = !!videoUrl;
  const isImageMode = imageUrls.length > 0;
  
  // Get current keypoint configuration (including custom configs)
  const allKeypointConfigs = { ...KEYPOINT_CONFIGS, ...customKeypointConfigs };
  const keypointConfig = allKeypointConfigs[currentKeypointConfig];
  const keypointLabels = keypointConfig.keypoints;
  const skeletonConnections = keypointConfig.skeleton;

  // Save state to undo stack - SEPARATE FUNCTIONS FOR EACH MODE
  const saveToUndoStack = () => {
    if (multiAnimalMode) {
      saveToMultiAnimalUndoStack();
    } else {
      saveToSingleAnimalUndoStack();
    }
  };

  // SINGLE-ANIMAL MODE: Keep original behavior (UNCHANGED)
  const saveToSingleAnimalUndoStack = () => {
    setSingleAnimalUndoStack((prevUndo) => [...prevUndo, { 
      annotations: singleAnimalAnnotations, 
      currentFrame, 
      keypointIndex
    }]);
    setSingleAnimalRedoStack([]); // Clear redo stack on new action
  };

  // MULTI-ANIMAL MODE: New implementation with deep copy
  const saveToMultiAnimalUndoStack = () => {
    // CRITICAL: Make deep copy to avoid reference issues
    const annotationsCopy = JSON.parse(JSON.stringify(multiAnimalAnnotations));
    
    setMultiAnimalUndoStack((prevUndo) => [...prevUndo, { 
      annotations: annotationsCopy, 
      currentFrame, 
      keypointIndex
    }]);
    setMultiAnimalRedoStack([]); // Clear redo stack on new action
  };

  // Handle video load: show modal for stride selection
  const handleVideoLoad = (file) => {
    const url = URL.createObjectURL(file);
    setPendingVideo(file);
    setPendingUrl(url);
    setShowModal(true);
  };

  // Handle load annotations
  const handleLoadAnnotations = () => {
    setShowLoadModal(true);
    setLoadImageFiles([]);
    setLoadLabelFiles([]);
    setLoadImageDirectory('');
    setLoadLabelDirectory('');
    setLoadError('');
  };

  // When modal is shown, load video metadata
  useEffect(() => {
    if (!showModal || !pendingUrl) return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = pendingUrl;
    video.onloadedmetadata = () => {
      const fps = video.webkitVideoDecodedByteCount ? 30 : (video.frameRate || 30); // fallback
      const totalVideoFrames = Math.floor(video.duration * fps);
      setVideoMeta({
        fps: video.fps || fps,
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      setStride(1);
      setTargetFrames(totalVideoFrames); // Initialize with all frames
      setInputMode('stride'); // Default to stride mode
      setRandomFrameCount(Math.min(100, totalVideoFrames)); // Default to 100 or max available
      setModalView('stride'); // Default to stride view
    };
  }, [showModal, pendingUrl]);

  // Handle stride change - update target frames
  const handleStrideChange = (newStride) => {
    setStride(newStride);
    setInputMode('stride');
    if (videoMeta.duration && videoMeta.fps) {
      const totalVideoFrames = Math.floor(videoMeta.duration * videoMeta.fps);
      const calculatedTargetFrames = Math.ceil(totalVideoFrames / newStride);
      setTargetFrames(calculatedTargetFrames);
    }
  };

  // Handle target frames change - update stride
  const handleTargetFramesChange = (newTargetFrames) => {
    setTargetFrames(newTargetFrames);
    setInputMode('frames');
    if (videoMeta.duration && videoMeta.fps && newTargetFrames > 0) {
      const totalVideoFrames = Math.floor(videoMeta.duration * videoMeta.fps);
      const calculatedStride = Math.max(1, Math.floor(totalVideoFrames / newTargetFrames));
      setStride(calculatedStride);
    }
  };

  // Handle random frame count change
  const handleRandomFrameCountChange = (newCount) => {
    setRandomFrameCount(newCount);
  };

  // Generate stratified random frame indices
  const generateRandomFrameIndices = (totalFrames, sampleCount) => {
    const indices = [];
    const segmentSize = totalFrames / sampleCount;
    
    for (let i = 0; i < sampleCount; i++) {
      const segmentStart = Math.floor(i * segmentSize);
      const segmentEnd = Math.floor((i + 1) * segmentSize);
      const randomIndex = segmentStart + Math.floor(Math.random() * (segmentEnd - segmentStart));
      indices.push(Math.min(randomIndex, totalFrames - 1));
    }
    
    return indices.sort((a, b) => a - b); // Sort to maintain temporal order
  };

  // Handle ESC key for modal
  useEffect(() => {
    if (!showModal) return;
    
    const handleModalKeyDown = (e) => {
      if (e.key === 'Escape' && !extracting) {
        e.preventDefault();
        setShowModal(false);
        setPendingVideo(null);
        setPendingUrl(null);
        setExtractError('');
        setExtractProgress(0);
        setModalView('stride');
      }
    };
    
    window.addEventListener('keydown', handleModalKeyDown);
    return () => window.removeEventListener('keydown', handleModalKeyDown);
  }, [showModal, extracting]);

  // Handle ESC key for load modal
  useEffect(() => {
    if (!showLoadModal) return;
    
    const handleLoadModalKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowLoadModal(false);
        setLoadImageFiles([]);
        setLoadLabelFiles([]);
        setLoadImageDirectory('');
        setLoadLabelDirectory('');
        setLoadError('');
      }
    };
    
    window.addEventListener('keydown', handleLoadModalKeyDown);
    return () => window.removeEventListener('keydown', handleLoadModalKeyDown);
  }, [showLoadModal]);

  // Handle ESC key for keypoint config modal
  useEffect(() => {
    if (!showKeypointConfigModal) return;
    
    const handleKeypointConfigModalKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowKeypointConfigModal(false);
      }
    };
    
    window.addEventListener('keydown', handleKeypointConfigModalKeyDown);
    return () => window.removeEventListener('keydown', handleKeypointConfigModalKeyDown);
  }, [showKeypointConfigModal]);

  // Extract frames at stride, with progress and error handling
  const extractFrames = async () => {
    setExtracting(true);
    setExtractProgress(0);
    setExtractError('');
    try {
      const video = document.createElement('video');
      video.src = pendingUrl;
      video.crossOrigin = 'anonymous';
      await new Promise(res => { video.onloadedmetadata = res; });
      const fps = videoMeta.fps || 30;
      const duration = videoMeta.duration;
      const total = Math.floor(duration * fps);
      
      let frameIndices = [];
      
      if (modalView === 'random') {
        // Generate random frame indices using stratified sampling
        frameIndices = generateRandomFrameIndices(total, randomFrameCount);
      } else {
        // Use stride-based sampling
        const strideVal = Math.max(1, stride);
        
        if (inputMode === 'frames') {
          // When user specified target frames, limit to exact count
          for (let i = 0; i < total && frameIndices.length < targetFrames; i += strideVal) {
            frameIndices.push(i);
          }
        } else {
          // When user specified stride, use original logic
          for (let i = 0; i < total; i += strideVal) {
            frameIndices.push(i);
          }
        }
      }
      
      // Store original frame indices for export
      setOriginalFrameIndices(frameIndices);
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      const urls = [];
      const names = []; // Generate frame names
      for (let idx = 0; idx < frameIndices.length; idx++) {
        const frame = frameIndices[idx];
        video.currentTime = frame / fps;
        await new Promise((res, rej) => {
          let timeout = setTimeout(() => rej(new Error('Frame extraction timeout')), 10000);
          video.onseeked = () => { clearTimeout(timeout); res(); };
        });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        urls.push(canvas.toDataURL('image/jpeg'));
        
        // Generate frame name using 6-digit padding (same as export logic)
        const frameName = frame.toString().padStart(6, '0') + '.jpg';
        names.push(frameName);
        
        setExtractProgress(Math.round(((idx + 1) / frameIndices.length) * 100));
      }
      setImageFiles([]);
      setImageUrls(urls);
      setFrameNames(names); // Store frame names
      setVideoFile(null);
      setVideoUrl(null);
      setAnnotations([]);
      setCurrentFrame(0);
      setMode(null);
      setKeypointIndex(0);
      setShowModal(false);
      setExtracting(false);
      setExtractProgress(0);
      setModalView('stride');
      
      // Set initial frame name for video mode
      setCurrentImageName(names[0] || '');
    } catch (err) {
      setExtractError('Failed to extract frames: ' + err.message);
      setExtracting(false);
      setExtractProgress(0);
    }
  };

  const handleImagesLoad = (files) => {
    const urls = files.map(file => URL.createObjectURL(file));
    setImageFiles(files);
    setImageUrls(urls);
    setVideoFile(null);
    setVideoUrl(null);
    setAnnotations([]);
    setCurrentFrame(0);
    setMode(null);
    setKeypointIndex(0);
    setCurrentImageName(files[0]?.name || '');
    setFrameNames([]); // Clear frame names for image mode
  };

  const handlePrevFrame = () => {
    const newFrame = Math.max(0, currentFrame - 1);
    setCurrentFrame(newFrame);
    // Use frame names for video mode, or file names for image mode
    if (frameNames.length > 0) {
      setCurrentImageName(frameNames[newFrame] || '');
    } else {
      setCurrentImageName(imageFiles[newFrame]?.name || '');
    }
  };

  const handleNextFrame = () => {
    const newFrame = Math.min((totalFrames || 1) - 1, currentFrame + 1);
    setCurrentFrame(newFrame);
    // Use frame names for video mode, or file names for image mode
    if (frameNames.length > 0) {
      setCurrentImageName(frameNames[newFrame] || '');
    } else {
      setCurrentImageName(imageFiles[newFrame]?.name || '');
    }
  };

  const handleFrameChange = (frame) => {
    setCurrentFrame(frame);
    // Use frame names for video mode, or file names for image mode
    if (frameNames.length > 0) {
      setCurrentImageName(frameNames[frame] || '');
    } else {
      setCurrentImageName(imageFiles[frame]?.name || '');
    }
  };

  // Undo/redo handlers - ROUTE TO CORRECT IMPLEMENTATION
  const handleUndo = () => {
    if (multiAnimalMode) {
      handleMultiAnimalUndo();
    } else {
      handleSingleAnimalUndo();
    }
  };

  // SINGLE-ANIMAL MODE: Keep original behavior (UNCHANGED)
  const handleSingleAnimalUndo = () => {
    if (singleAnimalUndoStack.length === 0) return;
    
    const lastState = singleAnimalUndoStack[singleAnimalUndoStack.length - 1];
    const currentState = { annotations: singleAnimalAnnotations, currentFrame, keypointIndex };
    
    // Push current state to redo stack
    setSingleAnimalRedoStack(prev => [...prev, currentState]);
    
    // Restore the last state
    setSingleAnimalAnnotations(lastState.annotations);
    setCurrentFrame(lastState.currentFrame);
    setKeypointIndex(lastState.keypointIndex !== undefined ? lastState.keypointIndex : 0);
    
    // Clear selections immediately as before
    setSelectedBbox(false);
    setSelectedSkeleton(false);
    setSelectedImageObjects(new Set());
    
    // Clear ref-based selections in VideoPlayer
    if (videoPlayerRef.current) {
      videoPlayerRef.current.clearRefSelectionsOnly();
    }
    
    // Remove the last state from undo stack
    setSingleAnimalUndoStack(prev => prev.slice(0, -1));
  };

  // MULTI-ANIMAL MODE: New implementation with proper state restoration
  const handleMultiAnimalUndo = () => {
    if (multiAnimalUndoStack.length === 0) return;
    
    const lastState = multiAnimalUndoStack[multiAnimalUndoStack.length - 1];
    const currentState = { 
      annotations: JSON.parse(JSON.stringify(multiAnimalAnnotations)), // Deep copy current state
      currentFrame, 
      keypointIndex 
    };
    
    // Push current state to redo stack
    setMultiAnimalRedoStack(prev => [...prev, currentState]);
    
    // Restore the last state
    setMultiAnimalAnnotations(lastState.annotations);
    setCurrentFrame(lastState.currentFrame);
    setKeypointIndex(lastState.keypointIndex !== undefined ? lastState.keypointIndex : 0);
    
    // In multi-animal mode, provide visual feedback by preserving selections briefly
    setTimeout(() => {
      setSelectedBbox(false);
      setSelectedSkeleton(false);
      setSelectedImageObjects(new Set());
      
      // Clear ref-based selections in VideoPlayer
      if (videoPlayerRef.current) {
        videoPlayerRef.current.clearRefSelectionsOnly();
      }
    }, 1000);
    
    // Remove the last state from undo stack
    setMultiAnimalUndoStack(prev => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (multiAnimalMode) {
      handleMultiAnimalRedo();
    } else {
      handleSingleAnimalRedo();
    }
  };

  // SINGLE-ANIMAL MODE: Keep original behavior (UNCHANGED)
  const handleSingleAnimalRedo = () => {
    if (singleAnimalRedoStack.length === 0) return;
    
    const lastRedoState = singleAnimalRedoStack[singleAnimalRedoStack.length - 1];
    const currentState = { annotations: singleAnimalAnnotations, currentFrame, keypointIndex };
    
    // Push current state to undo stack
    setSingleAnimalUndoStack(prev => [...prev, currentState]);
    
    // Restore the redo state
    setSingleAnimalAnnotations(lastRedoState.annotations);
    setCurrentFrame(lastRedoState.currentFrame);
    setKeypointIndex(lastRedoState.keypointIndex !== undefined ? lastRedoState.keypointIndex : 0);
    
    // Clear selections immediately as before
    setSelectedBbox(false);
    setSelectedSkeleton(false);
    setSelectedImageObjects(new Set());
    
    // Clear ref-based selections in VideoPlayer
    if (videoPlayerRef.current) {
      videoPlayerRef.current.clearRefSelectionsOnly();
    }
    
    // Remove the last state from redo stack
    setSingleAnimalRedoStack(prev => prev.slice(0, -1));
  };

  // MULTI-ANIMAL MODE: New implementation with proper state restoration
  const handleMultiAnimalRedo = () => {
    if (multiAnimalRedoStack.length === 0) return;
    
    const lastRedoState = multiAnimalRedoStack[multiAnimalRedoStack.length - 1];
    const currentState = { 
      annotations: JSON.parse(JSON.stringify(multiAnimalAnnotations)), // Deep copy current state
      currentFrame, 
      keypointIndex 
    };
    
    // Push current state to undo stack
    setMultiAnimalUndoStack(prev => [...prev, currentState]);
    
    // Restore the redo state
    setMultiAnimalAnnotations(lastRedoState.annotations);
    setCurrentFrame(lastRedoState.currentFrame);
    setKeypointIndex(lastRedoState.keypointIndex !== undefined ? lastRedoState.keypointIndex : 0);
    
    // In multi-animal mode, provide visual feedback by preserving selections briefly
    setTimeout(() => {
      setSelectedBbox(false);
      setSelectedSkeleton(false);
      setSelectedImageObjects(new Set());
      
      // Clear ref-based selections in VideoPlayer
      if (videoPlayerRef.current) {
        videoPlayerRef.current.clearRefSelectionsOnly();
      }
    }, 1000);
    
    // Remove the last state from redo stack
    setMultiAnimalRedoStack(prev => prev.slice(0, -1));
  };

  // Keyboard shortcuts for undo/redo and mode switching
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if user is typing in an input field
      const isInputFocused = e.target.tagName === 'INPUT' || 
                            e.target.tagName === 'TEXTAREA' || 
                            e.target.isContentEditable;
      
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo(); // Ctrl+Shift+Z for redo
        } else {
          handleUndo(); // Ctrl+Z for undo
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo(); // Ctrl+Y for redo
      } else if (e.key === '1' && !isInputFocused) {
        // Only trigger keypoint mode if not typing in an input field
        setMode('keypoint');
        // Find first unlabeled keypoint for current frame
        setKeypointIndex(() => {
          const ann = annotations[currentFrame] || {};
          const kp = ann.keypoints || [];
          for (let i = 0; i < keypointLabels.length; i++) {
            if (!kp[i]) return i;
          }
          return 0;
        });
      } else if (e.key === '2' && !isInputFocused) {
        // Only trigger bbox mode if not typing in an input field
        setMode('bbox');
      } else if (e.key === '3' && !isInputFocused) {
        // Only trigger default mode if not typing in an input field
        setMode(null);
      } else if (e.key === '4' && !isInputFocused) {
        // Toggle keypoint labels visibility
        e.preventDefault();
        setShowKeypointLabels(!showKeypointLabels);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line
  }, [handleUndo, handleRedo, annotations, currentFrame, keypointLabels, showKeypointLabels]);

  // Keypoint label for indicator
  const keypointLabel = mode === 'keypoint' ? keypointLabels[keypointIndex] : '';

  // Helper: YOLO export for a single annotation
  function annotationToYOLO(classId, bboxNorm, keypointsNorm, visibilities) {
    // bboxNorm: [x, y, w, h] (normalized)
    // keypointsNorm: [{x, y}, ...] (normalized)
    // visibilities: [2, 1, 0, ...]
    let line = `${classId} ${bboxNorm[0]} ${bboxNorm[1]} ${bboxNorm[2]} ${bboxNorm[3]}`;
    for (let i = 0; i < keypointsNorm.length; i++) {
      const pt = keypointsNorm[i] || { x: 0, y: 0 };
      const vis = visibilities && visibilities[i] !== undefined ? visibilities[i] : 2;
      line += ` ${pt.x} ${pt.y} ${vis}`;
    }
    return line;
  }

  // Helper: Parse YOLO format to annotation
  function parseYOLOLine(line, imageWidth, imageHeight) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) return null;
    
    // Parse bounding box (normalized -> absolute)
    const [classId, cx, cy, w, h] = parts.slice(0, 5).map(Number);
    const bbox = [
      (cx - w/2) * imageWidth,  // x
      (cy - h/2) * imageHeight, // y
      w * imageWidth,           // width
      h * imageHeight           // height
    ];
    
    // Parse keypoints (normalized -> absolute)
    const keypoints = [];
    const visibilities = [];
    for (let i = 5; i < parts.length; i += 3) {
      if (i + 2 < parts.length) {
        const x = parseFloat(parts[i]) * imageWidth;
        const y = parseFloat(parts[i + 1]) * imageHeight;
        const vis = parseInt(parts[i + 2]);
        keypoints.push({ x, y });
        visibilities.push(vis);
      }
    }
    
    return { bbox, keypoints, visibilities, skeletonId: classId, bboxId: classId };
  }

  // Helper: Check if keypoints are inside or close to a bounding box
  function keypointsMatchBbox(keypoints, bbox, tolerance = 0.1) {
    if (!keypoints || !bbox || bbox.length !== 4) return false;
    
    const [bx, by, bw, bh] = bbox;
    const validKeypoints = keypoints.filter(pt => pt && pt.x !== undefined && pt.y !== undefined);
    
    if (validKeypoints.length === 0) return false;
    
    // Calculate keypoints bounding box
    const kpXs = validKeypoints.map(pt => pt.x);
    const kpYs = validKeypoints.map(pt => pt.y);
    const kpMinX = Math.min(...kpXs);
    const kpMaxX = Math.max(...kpXs);
    const kpMinY = Math.min(...kpYs);
    const kpMaxY = Math.max(...kpYs);
    
    // Add tolerance padding to bbox
    const padding = Math.min(bw, bh) * tolerance;
    const expandedBbox = {
      left: bx - padding,
      right: bx + bw + padding,
      top: by - padding,
      bottom: by + bh + padding
    };
    
    // Check if majority of keypoints are within expanded bbox
    let insideCount = 0;
    validKeypoints.forEach(pt => {
      if (pt.x >= expandedBbox.left && pt.x <= expandedBbox.right &&
          pt.y >= expandedBbox.top && pt.y <= expandedBbox.bottom) {
        insideCount++;
      }
    });
    
    // Consider a match if at least 50% of keypoints are inside
    return (insideCount / validKeypoints.length) >= 0.5;
  }

  // Helper: Find best bbox match for skeleton keypoints
  function findBestBboxMatch(skeleton, candidateBboxes) {
    if (!skeleton.keypoints || candidateBboxes.length === 0) return null;
    
    // First try exact spatial matching
    for (const bboxData of candidateBboxes) {
      if (keypointsMatchBbox(skeleton.keypoints, bboxData.bbox)) {
        return bboxData;
      }
    }
    
    // If no exact match, find closest bbox by center distance
    const skeletonKeypoints = skeleton.keypoints.filter(pt => pt && pt.x !== undefined && pt.y !== undefined);
    if (skeletonKeypoints.length === 0) return candidateBboxes[0]; // fallback
    
    const skeletonCenterX = skeletonKeypoints.reduce((sum, pt) => sum + pt.x, 0) / skeletonKeypoints.length;
    const skeletonCenterY = skeletonKeypoints.reduce((sum, pt) => sum + pt.y, 0) / skeletonKeypoints.length;
    
    let bestMatch = candidateBboxes[0];
    let minDistance = Infinity;
    
    candidateBboxes.forEach(bboxData => {
      const [bx, by, bw, bh] = bboxData.bbox;
      const bboxCenterX = bx + bw / 2;
      const bboxCenterY = by + bh / 2;
      const distance = Math.sqrt(Math.pow(skeletonCenterX - bboxCenterX, 2) + Math.pow(skeletonCenterY - bboxCenterY, 2));
      
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = bboxData;
      }
    });
    
    return bestMatch;
  }

  // Helper: Parse multiple YOLO lines for multi-animal mode
  function parseMultiAnimalYOLO(labelText, imageWidth, imageHeight) {
    const lines = labelText.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;

    const skeletons = [];
    const bboxes = [];

    lines.forEach(line => {
      const parsed = parseYOLOLine(line, imageWidth, imageHeight);
      if (parsed) {
        const { bbox, keypoints, visibilities, skeletonId } = parsed;
        
        // Set all visibilities to 2 (visible)
        const adjustedVisibilities = visibilities.map(() => 2);
        
        // Check if keypoints exist (not all zeros)
        const hasKeypoints = keypoints.some(pt => pt.x !== 0 || pt.y !== 0);
        
        if (hasKeypoints) {
          // Add skeleton
          skeletons.push({
            id: skeletonId,
            keypoints: keypoints,
            visibilities: adjustedVisibilities
          });
        }
        
        // Add bbox (always, since it's required for YOLO format)
        bboxes.push({
          id: skeletonId,
          bbox: bbox
        });
      }
    });

    // Return multi-animal annotation structure
    return {
      skeletons: skeletons,
      bboxes: bboxes
    };
  }

  // Handle image files selection
  const handleImageFilesSelect = (e) => {
    const files = Array.from(e.target.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    setLoadImageFiles(imageFiles);
    
    // Detect if files are from the same directory
    if (imageFiles.length > 0) {
      const firstFile = imageFiles[0];
      if (firstFile.webkitRelativePath) {
        // Files selected from directory
        const dirName = firstFile.webkitRelativePath.split('/')[0];
        setLoadImageDirectory(dirName);
      } else {
        // Individual files selected - check if they're from same folder
        const paths = imageFiles.map(f => f.name);
        const allSamePath = paths.every(p => p.includes('/') && p.split('/')[0] === paths[0].split('/')[0]);
        if (allSamePath && paths[0].includes('/')) {
          setLoadImageDirectory(paths[0].split('/')[0]);
        } else {
          setLoadImageDirectory('');
        }
      }
    } else {
      setLoadImageDirectory('');
    }
  };

  // Handle label files selection  
  const handleLabelFilesSelect = (e) => {
    const files = Array.from(e.target.files);
    const labelFiles = files.filter(f => f.name.endsWith('.txt'));
    setLoadLabelFiles(labelFiles);
    
    // Detect if files are from the same directory
    if (labelFiles.length > 0) {
      const firstFile = labelFiles[0];
      if (firstFile.webkitRelativePath) {
        // Files selected from directory
        const dirName = firstFile.webkitRelativePath.split('/')[0];
        setLoadLabelDirectory(dirName);
      } else {
        // Individual files selected - check if they're from same folder
        const paths = labelFiles.map(f => f.name);
        const allSamePath = paths.every(p => p.includes('/') && p.split('/')[0] === paths[0].split('/')[0]);
        if (allSamePath && paths[0].includes('/')) {
          setLoadLabelDirectory(paths[0].split('/')[0]);
        } else {
          setLoadLabelDirectory('');
        }
      }
    } else {
      setLoadLabelDirectory('');
    }
  };

  // Process loaded annotations
  const processLoadedAnnotations = async () => {
    if (loadImageFiles.length === 0) {
      setLoadError('Please select image files');
      return;
    }
    
    try {
      setLoadError('');
      
      // Create image URLs
      const imageUrls = loadImageFiles.map(file => URL.createObjectURL(file));
      
      // Create filename mapping (without extension)
      const getBaseName = (filename) => filename.replace(/\.[^/.]+$/, '');
      
      // Map images by basename
      const imageMap = new Map();
      loadImageFiles.forEach((file, index) => {
        const baseName = getBaseName(file.name);
        imageMap.set(baseName, { file, url: imageUrls[index], index });
      });
      
      // Map labels by basename and auto-detect multi-animal mode
      const labelMap = new Map();
      let hasMultipleObjects = false;
      
      for (const labelFile of loadLabelFiles) {
        const baseName = getBaseName(labelFile.name);
        const text = await labelFile.text();
        const trimmedText = text.trim();
        labelMap.set(baseName, trimmedText);
        
        // Check if this label file contains multiple lines (indicating multiple objects)
        if (trimmedText) {
          const lines = trimmedText.split('\n').filter(line => line.trim());
          if (lines.length > 1) {
            hasMultipleObjects = true;
          }
          
          // Also check if any single line has multiple objects with different IDs
          const uniqueIds = new Set();
          lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const classId = parseInt(parts[0]);
              uniqueIds.add(classId);
            }
          });
          
          if (uniqueIds.size > 1) {
            hasMultipleObjects = true;
          }
        }
      }
      
      // Auto-switch to multi-animal mode if multiple objects detected
      let detectedMode = multiAnimalMode;
      if (hasMultipleObjects && !multiAnimalMode) {
        setMultiAnimalMode(true);
        detectedMode = true;
        console.log('Auto-detected multiple objects in label files. Switching to multi-animal mode.');
      }
      
      // Sort by filename with natural/numerical ordering
      const naturalSort = (a, b) => {
        // Split filename into chunks of text and numbers
        const chunksA = a.match(/(\d+|\D+)/g) || [];
        const chunksB = b.match(/(\d+|\D+)/g) || [];
        
        const maxLength = Math.max(chunksA.length, chunksB.length);
        
        for (let i = 0; i < maxLength; i++) {
          const chunkA = chunksA[i] || '';
          const chunkB = chunksB[i] || '';
          
          // If both chunks are numeric, compare as numbers
          if (/^\d+$/.test(chunkA) && /^\d+$/.test(chunkB)) {
            const numA = parseInt(chunkA, 10);
            const numB = parseInt(chunkB, 10);
            if (numA !== numB) {
              return numA - numB;
            }
          } else {
            // Compare as strings
            const result = chunkA.localeCompare(chunkB);
            if (result !== 0) {
              return result;
            }
          }
        }
        
        return 0;
      };
      
      const sortedImages = Array.from(imageMap.entries()).sort(([a], [b]) => naturalSort(a, b));
      
      // Create final arrays
      const finalImageFiles = [];
      const finalImageUrls = [];
      const finalAnnotations = [];
      
      for (const [baseName, imageData] of sortedImages) {
        finalImageFiles.push(imageData.file);
        finalImageUrls.push(imageData.url);
        
        // Try to find matching label
        const labelText = labelMap.get(baseName);
        let annotation = null;
        
        if (labelText) {
          // Load image to get dimensions
          const img = new Image();
          img.src = imageData.url;
          await new Promise(resolve => { img.onload = resolve; });
          
          if (detectedMode) {
            // Multi-animal mode: parse multiple YOLO lines
            annotation = parseMultiAnimalYOLO(labelText, img.naturalWidth, img.naturalHeight);
          } else {
            // Single animal mode: parse single YOLO line
            const parsed = parseYOLOLine(labelText, img.naturalWidth, img.naturalHeight);
            if (parsed) {
              // Set all visibilities to 2
              if (parsed.visibilities) {
                parsed.visibilities = parsed.visibilities.map(() => 2);
              }
              annotation = parsed;
            }
          }
        }
        
        finalAnnotations.push(annotation);
      }
      
      // Set the data
      setImageFiles(finalImageFiles);
      setImageUrls(finalImageUrls);
      
      // Set annotations in the correct mode's storage
      if (detectedMode) {
        setMultiAnimalAnnotations(finalAnnotations);
      } else {
        setSingleAnimalAnnotations(finalAnnotations);
      }
      
      setCurrentFrame(0);
      setMode(null);
      setKeypointIndex(0);
      setVideoFile(null);
      setVideoUrl(null);
      setCurrentImageName(finalImageFiles[0]?.name || '');
      setFrameNames([]); // Clear frame names for loaded image mode
      
      // Update current IDs to be the next available after imported annotations
      if (detectedMode) {
        let maxSkeletonId = -1;
        let maxBboxId = -1;
        
        // Scan all imported annotations to find highest IDs
        finalAnnotations.forEach(annotation => {
          if (annotation) {
            // Check completed skeletons
            if (annotation.skeletons) {
              annotation.skeletons.forEach(skeleton => {
                if (skeleton.id !== undefined) {
                  maxSkeletonId = Math.max(maxSkeletonId, skeleton.id);
                }
              });
            }
            
            // Check completed bboxes
            if (annotation.bboxes) {
              annotation.bboxes.forEach(bbox => {
                if (bbox.id !== undefined) {
                  maxBboxId = Math.max(maxBboxId, bbox.id);
                }
              });
            }
            
            // Check working skeleton/bbox IDs (legacy support)
            if (annotation.skeletonId !== undefined) {
              maxSkeletonId = Math.max(maxSkeletonId, annotation.skeletonId);
            }
            if (annotation.bboxId !== undefined) {
              maxBboxId = Math.max(maxBboxId, annotation.bboxId);
            }
          }
        });
        
        // Set next available IDs (start from 0 if no annotations found)
        const nextSkeletonId = maxSkeletonId >= 0 ? maxSkeletonId + 1 : 0;
        const nextBboxId = maxBboxId >= 0 ? maxBboxId + 1 : 0;
        
        setCurrentSkeletonId(nextSkeletonId);
        setCurrentBboxId(nextBboxId);
      } else {
        // Single animal mode: reset to default
        setCurrentSkeletonId(0);
        setCurrentBboxId(0);
      }
      
      setShowLoadModal(false);
      
    } catch (error) {
      setLoadError('Error processing files: ' + error.message);
    }
  };

  // Handle keypoint configuration change
  const handleKeypointConfigChange = (configKey) => {
    setCurrentKeypointConfig(configKey);
    setShowKeypointConfigModal(false);
    
    // Reset annotation mode and keypoint index when changing config
    setMode(null);
    setKeypointIndex(0);
    
    // Clear existing annotations if keypoint count differs
    const newConfig = allKeypointConfigs[configKey];
    if (annotations.length > 0) {
      const currentConfig = allKeypointConfigs[currentKeypointConfig];
      if (newConfig.keypoints.length !== currentConfig.keypoints.length) {
        // Could prompt user to confirm, for now just clear
        setAnnotations([]);
      }
    }
  };

  // Export keypoint configuration
  const handleExportKeypointConfig = () => {
    const config = allKeypointConfigs[currentKeypointConfig];
    const exportData = {
      version: "1.0",
      name: config.name,
      keypoints: config.keypoints.map((name, index) => ({
        id: index,
        name: name
      })),
      skeleton: config.skeleton.map(([idx1, idx2]) => ({
        from: idx1,
        to: idx2
      })),
      metadata: {
        totalKeypoints: config.keypoints.length,
        totalConnections: config.skeleton.length,
        exportedAt: new Date().toISOString(),
        exportedBy: "Video Annotator v2"
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name.toLowerCase().replace(/\s+/g, '_')}_keypoint_config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import keypoint configuration
  const handleImportKeypointConfig = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        
        // Validate the imported data
        if (!importData.name || !importData.keypoints || !importData.skeleton) {
          alert('Invalid keypoint configuration file format');
          return;
        }

        // Convert imported format to internal format
        const configKey = importData.name.toLowerCase().replace(/\s+/g, '_');
        const newConfig = {
          name: importData.name,
          keypoints: importData.keypoints.map(kp => kp.name),
          skeleton: importData.skeleton.map(conn => [conn.from, conn.to])
        };

        // Add to custom configs
        setCustomKeypointConfigs(prev => ({
          ...prev,
          [configKey]: newConfig
        }));

        // Switch to the imported config
        setCurrentKeypointConfig(configKey);
        
        alert(`Successfully imported keypoint configuration: ${importData.name}`);
      } catch (error) {
        alert('Error parsing keypoint configuration file: ' + error.message);
      }
    };
    reader.readAsText(file);
    
    // Reset input
    event.target.value = '';
  };

  // Validate ID consistency across all annotations
  const validateIdConsistency = () => {
    const issues = [];
    const mismatchedFrames = [];
    
    if (multiAnimalMode) {
      // MULTI-ANIMAL MODE: Check ID pair consistency across all frames
      const skeletonIdCounts = new Map(); // ID -> count
      const bboxIdCounts = new Map(); // ID -> count
      
      // Count skeletons and bboxes for each ID across all frames
      annotations.forEach((ann, frameIndex) => {
        if (!ann) return;
        
        // Count completed skeletons
        if (ann.skeletons) {
          ann.skeletons.forEach(skeleton => {
            if (skeleton.keypoints && skeleton.keypoints.some(pt => pt !== null)) {
              const id = skeleton.id;
              skeletonIdCounts.set(id, (skeletonIdCounts.get(id) || 0) + 1);
            }
          });
        }
        
        // Count working skeleton
        if (ann.keypoints && ann.keypoints.some(pt => pt !== null)) {
          const id = ann.skeletonId !== undefined ? ann.skeletonId : 0;
          skeletonIdCounts.set(id, (skeletonIdCounts.get(id) || 0) + 1);
        }
        
        // Count completed bboxes
        if (ann.bboxes) {
          ann.bboxes.forEach(bbox => {
            if (bbox.bbox && bbox.bbox.length === 4) {
              const id = bbox.id;
              bboxIdCounts.set(id, (bboxIdCounts.get(id) || 0) + 1);
            }
          });
        }
        
        // Count working bbox
        if (ann.bbox && ann.bbox.length === 4) {
          const id = ann.bboxId !== undefined ? ann.bboxId : 0;
          bboxIdCounts.set(id, (bboxIdCounts.get(id) || 0) + 1);
        }
      });
      
      // Get all unique IDs
      const allIds = new Set([...skeletonIdCounts.keys(), ...bboxIdCounts.keys()]);
      
      // Check each ID for matching counts
      allIds.forEach(id => {
        const skeletonCount = skeletonIdCounts.get(id) || 0;
        const bboxCount = bboxIdCounts.get(id) || 0;
        
        if (skeletonCount !== bboxCount) {
          issues.push(`ID ${id}: ${skeletonCount} skeleton(s) ≠ ${bboxCount} bbox(es)`);
        }
      });
      
    } else {
      // SINGLE ANIMAL MODE: Original logic - check each frame for ID mismatches
      annotations.forEach((ann, frameIndex) => {
        if (!ann) return;
        
        const hasKeypoints = ann.keypoints && ann.keypoints.some(pt => pt !== null);
        const hasBbox = ann.bbox && ann.bbox.length === 4;
        
        // Only check frames that have both skeleton and bbox
        if (hasKeypoints && hasBbox) {
          const skeletonId = ann.skeletonId !== undefined ? ann.skeletonId : 0;
          const bboxId = ann.bboxId !== undefined ? ann.bboxId : 0;
          
          if (skeletonId !== bboxId) {
            mismatchedFrames.push({
              frame: frameIndex,
              skeletonId: skeletonId,
              bboxId: bboxId
            });
          }
        }
      });
      
      // Generate warning messages for mismatched frames
      if (mismatchedFrames.length > 0) {
        mismatchedFrames.forEach(mismatch => {
          issues.push(`Frame ${mismatch.frame}: Skeleton ID ${mismatch.skeletonId} ≠ Bbox ID ${mismatch.bboxId}`);
        });
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues: issues,
      mismatchedFrames: mismatchedFrames
    };
  };

  // Export handler
  const handleExport = async () => {
    // Validate ID consistency first
    const validation = validateIdConsistency();
    
    if (!validation.isValid) {
      const message = `Warning: ID inconsistencies detected!\n\n${validation.issues.join('\n')}\n\nThis may result in incorrect YOLO annotations. Do you want to continue anyway?`;
      if (!confirm(message)) {
        return; // User chose to cancel export
      }
    }
    // Get image/video info
    const isVideo = !!videoFile || !!pendingVideo;
    const zip = new JSZip();
    let baseDir = '';
    if (isVideo) {
      const videoName = (videoFile || pendingVideo)?.name?.replace(/\.[^/.]+$/, '') || 'video';
      baseDir = videoName;
    }
    
    // Create directories in zip
    const framesDir = zip.folder(baseDir ? `${baseDir}/frames` : 'frames');
    const labelsDir = zip.folder(baseDir ? `${baseDir}/labels` : 'labels');
    
    // For each frame with annotation, create both image and label files
    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      
      // Check if frame has any annotations
      let hasAnnotations = false;
      if (multiAnimalMode) {
        hasAnnotations = (ann?.skeletons?.length > 0) || (ann?.bboxes?.length > 0) || 
                        (ann?.keypoints?.some(pt => pt !== null)) || (ann?.bbox?.length === 4);
      } else {
        hasAnnotations = ann && (ann.bbox || ann.keypoints);
      }
      
      if (!hasAnnotations) continue;
      
      // Load image to get dimensions and data
      const img = new window.Image();
      img.src = imageUrls[i];
      await new Promise(res => { img.onload = res; });
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      
      // Generate file names
      let baseName;
      if (isVideo) {
        // Use original frame index for video exports
        const originalFrameIndex = originalFrameIndices[i] || i;
        baseName = originalFrameIndex.toString().padStart(6, '0');
      } else {
        // Use image file name (without extension)
        const imgName = imageFiles[i]?.name || `frame_${i.toString().padStart(5, '0')}.jpg`;
        baseName = imgName.replace(/\.[^/.]+$/, '');
      }
      
      // Save image file
      // Convert image URL to blob
      const response = await fetch(imageUrls[i]);
      const imageBlob = await response.blob();
      framesDir.file(`${baseName}.jpg`, imageBlob);
      
      // Create YOLO labels
      const yoloLines = [];
      
      if (multiAnimalMode) {
        // MULTI-ANIMAL MODE: Process all skeletons and bboxes
        const processedPairs = new Set(); // Track processed skeleton-bbox pairs to avoid duplicates
        
        // Process completed skeletons
        if (ann.skeletons) {
          ann.skeletons.forEach((skeleton, skeletonIndex) => {
            if (!skeleton.keypoints || !skeleton.keypoints.some(pt => pt !== null)) return;
            
            const skeletonId = skeleton.id;
            
            // Find candidate bboxes with same ID
            const candidateBboxes = [];
            if (ann.bboxes) {
              ann.bboxes.forEach((bbox, bboxIndex) => {
                if (bbox.id === skeletonId && bbox.bbox && bbox.bbox.length === 4) {
                  candidateBboxes.push({ bbox: bbox.bbox, index: bboxIndex });
                }
              });
            }
            
            if (candidateBboxes.length > 0) {
              // Use spatial matching to find the best bbox for this skeleton
              const bestBboxMatch = findBestBboxMatch(skeleton, candidateBboxes);
              
              if (bestBboxMatch) {
                const pairKey = `skeleton_${skeletonIndex}_bbox_${bestBboxMatch.index}`;
                if (processedPairs.has(pairKey)) return;
                processedPairs.add(pairKey);
                
                const [x, y, w, h] = bestBboxMatch.bbox;
                const bboxNorm = [
                  ((x + w / 2) / width).toFixed(16),
                  ((y + h / 2) / height).toFixed(16),
                  (w / width).toFixed(16),
                  (h / height).toFixed(16),
                ];
                
                // Ensure keypoints array is the correct length
                const skeletonKeypoints = skeleton.keypoints || [];
                const keypointsNorm = [];
                for (let i = 0; i < keypointLabels.length; i++) {
                  const pt = skeletonKeypoints[i];
                  if (pt && pt.x !== undefined && pt.y !== undefined) {
                    keypointsNorm.push({
                      x: (pt.x / width).toFixed(16),
                      y: (pt.y / height).toFixed(16),
                    });
                  } else {
                    keypointsNorm.push({ x: 0, y: 0 });
                  }
                }
                
                const skeletonVisibilities = skeleton.visibilities || [];
                const visibilities = [];
                for (let i = 0; i < keypointLabels.length; i++) {
                  const vis = skeletonVisibilities[i];
                  if (vis !== undefined) {
                    visibilities.push(vis);
                  } else if (skeletonKeypoints[i] && skeletonKeypoints[i].x !== undefined) {
                    visibilities.push(2); // Default to visible if keypoint exists
                  } else {
                    visibilities.push(0); // Not labeled
                  }
                }
                
                const yoloLine = annotationToYOLO(skeletonId, bboxNorm, keypointsNorm, visibilities);
                yoloLines.push(yoloLine);
              }
            } else {
              // Calculate bbox from keypoints
              const validKeypoints = skeleton.keypoints.filter(pt => pt !== null);
              if (validKeypoints.length > 0) {
                const xs = validKeypoints.map(pt => pt.x);
                const ys = validKeypoints.map(pt => pt.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const padding = Math.min(width, height) * 0.1; // 10% padding
                const calculatedBbox = [
                  Math.max(0, minX - padding),
                  Math.max(0, minY - padding),
                  Math.min(width, maxX - minX + 2 * padding),
                  Math.min(height, maxY - minY + 2 * padding)
                ];
                
                const [x, y, w, h] = calculatedBbox;
                const bboxNorm = [
                  ((x + w / 2) / width).toFixed(16),
                  ((y + h / 2) / height).toFixed(16),
                  (w / width).toFixed(16),
                  (h / height).toFixed(16),
                ];
                
                // Ensure keypoints array is the correct length
                const skeletonKeypoints = skeleton.keypoints || [];
                const keypointsNorm = [];
                for (let i = 0; i < keypointLabels.length; i++) {
                  const pt = skeletonKeypoints[i];
                  if (pt && pt.x !== undefined && pt.y !== undefined) {
                    keypointsNorm.push({
                      x: (pt.x / width).toFixed(16),
                      y: (pt.y / height).toFixed(16),
                    });
                  } else {
                    keypointsNorm.push({ x: 0, y: 0 });
                  }
                }
                
                const skeletonVisibilities = skeleton.visibilities || [];
                const visibilities = [];
                for (let i = 0; i < keypointLabels.length; i++) {
                  const vis = skeletonVisibilities[i];
                  if (vis !== undefined) {
                    visibilities.push(vis);
                  } else if (skeletonKeypoints[i] && skeletonKeypoints[i].x !== undefined) {
                    visibilities.push(2); // Default to visible if keypoint exists
                  } else {
                    visibilities.push(0); // Not labeled
                  }
                }
                
                const yoloLine = annotationToYOLO(skeletonId, bboxNorm, keypointsNorm, visibilities);
                yoloLines.push(yoloLine);
              }
            }
          });
        }
        
        // Process working skeleton
        if (ann.keypoints && ann.keypoints.some(pt => pt !== null)) {
          const skeletonId = ann.skeletonId !== undefined ? ann.skeletonId : 0;
          
          // Find matching working bbox
          let bboxForSkeleton = null;
          if (ann.bbox && ann.bbox.length === 4) {
            const workingBboxId = ann.bboxId !== undefined ? ann.bboxId : 0;
            if (workingBboxId === skeletonId) {
              bboxForSkeleton = ann.bbox;
            }
          }
          
          if (!bboxForSkeleton) {
            // Calculate bbox from keypoints
            const validKeypoints = ann.keypoints.filter(pt => pt !== null);
            if (validKeypoints.length > 0) {
              const xs = validKeypoints.map(pt => pt.x);
              const ys = validKeypoints.map(pt => pt.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const padding = Math.min(width, height) * 0.1; // 10% padding
              bboxForSkeleton = [
                Math.max(0, minX - padding),
                Math.max(0, minY - padding),
                Math.min(width, maxX - minX + 2 * padding),
                Math.min(height, maxY - minY + 2 * padding)
              ];
            }
          }
          
          if (bboxForSkeleton) {
            const [x, y, w, h] = bboxForSkeleton;
            const bboxNorm = [
              ((x + w / 2) / width).toFixed(16),
              ((y + h / 2) / height).toFixed(16),
              (w / width).toFixed(16),
              (h / height).toFixed(16),
            ];
            
            // Ensure keypoints array is the correct length
            const workingKeypoints = ann.keypoints || [];
            const keypointsNorm = [];
            for (let i = 0; i < keypointLabels.length; i++) {
              const pt = workingKeypoints[i];
              if (pt && pt.x !== undefined && pt.y !== undefined) {
                keypointsNorm.push({
                  x: (pt.x / width).toFixed(16),
                  y: (pt.y / height).toFixed(16),
                });
              } else {
                keypointsNorm.push({ x: 0, y: 0 });
              }
            }
            
            const workingVisibilities = ann.visibilities || [];
            const visibilities = [];
            for (let i = 0; i < keypointLabels.length; i++) {
              const vis = workingVisibilities[i];
              if (vis !== undefined) {
                visibilities.push(vis);
              } else if (workingKeypoints[i] && workingKeypoints[i].x !== undefined) {
                visibilities.push(2); // Default to visible if keypoint exists
              } else {
                visibilities.push(0); // Not labeled
              }
            }
            
            const yoloLine = annotationToYOLO(skeletonId, bboxNorm, keypointsNorm, visibilities);
            yoloLines.push(yoloLine);
          }
        }
        
        // Process orphaned bboxes (bboxes without matching skeletons)
        if (ann.bboxes) {
          ann.bboxes.forEach((bbox, bboxIndex) => {
            if (!bbox.bbox || bbox.bbox.length !== 4) return;
            
            const bboxId = bbox.id;
            
            // Check if this bbox was already processed with a skeleton
            const hasMatchingSkeleton = ann.skeletons?.some(skeleton => 
              skeleton.id === bboxId && skeleton.keypoints?.some(pt => pt !== null)
            );
            
            // Also check working skeleton
            const workingSkeletonId = ann.skeletonId !== undefined ? ann.skeletonId : 0;
            const hasMatchingWorkingSkeleton = (workingSkeletonId === bboxId && 
              ann.keypoints?.some(pt => pt !== null));
            
            if (!hasMatchingSkeleton && !hasMatchingWorkingSkeleton) {
              // This is an orphaned bbox - export as bbox-only
              const [x, y, w, h] = bbox.bbox;
              const bboxNorm = [
                ((x + w / 2) / width).toFixed(16),
                ((y + h / 2) / height).toFixed(16),
                (w / width).toFixed(16),
                (h / height).toFixed(16),
              ];
              
              // Empty keypoints for bbox-only annotation
              const keypointsNorm = Array(keypointLabels.length).fill({ x: 0, y: 0 });
              const visibilities = Array(keypointLabels.length).fill(0); // All not labeled
              
              const yoloLine = annotationToYOLO(bboxId, bboxNorm, keypointsNorm, visibilities);
              yoloLines.push(yoloLine);
            }
          });
        }
        
        // Process orphaned working bbox
        if (ann.bbox && ann.bbox.length === 4) {
          const bboxId = ann.bboxId !== undefined ? ann.bboxId : 0;
          const hasMatchingWorkingSkeleton = (ann.skeletonId !== undefined && 
            ann.skeletonId === bboxId && ann.keypoints?.some(pt => pt !== null));
          
          if (!hasMatchingWorkingSkeleton) {
            // This is an orphaned working bbox - export as bbox-only
            const [x, y, w, h] = ann.bbox;
            const bboxNorm = [
              ((x + w / 2) / width).toFixed(16),
              ((y + h / 2) / height).toFixed(16),
              (w / width).toFixed(16),
              (h / height).toFixed(16),
            ];
            
            // Empty keypoints for bbox-only annotation
            const keypointsNorm = Array(keypointLabels.length).fill({ x: 0, y: 0 });
            const visibilities = Array(keypointLabels.length).fill(0); // All not labeled
            
            const yoloLine = annotationToYOLO(bboxId, bboxNorm, keypointsNorm, visibilities);
            yoloLines.push(yoloLine);
          }
        }
        
      } else {
        // SINGLE ANIMAL MODE: Original logic
        // Handle skeleton (keypoints) if present
        if (ann.keypoints && ann.keypoints.some(pt => pt !== null)) {
          // For skeleton annotation, use bbox if available, otherwise calculate from keypoints
          let bboxForSkeleton = ann.bbox;
          if (!bboxForSkeleton) {
            // Calculate bounding box from keypoints
            const validKeypoints = ann.keypoints.filter(pt => pt !== null);
            if (validKeypoints.length > 0) {
              const xs = validKeypoints.map(pt => pt.x);
              const ys = validKeypoints.map(pt => pt.y);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const padding = Math.min(width, height) * 0.1; // 10% padding
              bboxForSkeleton = [
                Math.max(0, minX - padding),
                Math.max(0, minY - padding),
                Math.min(width, maxX - minX + 2 * padding),
                Math.min(height, maxY - minY + 2 * padding)
              ];
            }
          }
          
          if (bboxForSkeleton) {
            const [x, y, w, h] = bboxForSkeleton;
            const bboxNorm = [
              ((x + w / 2) / width).toFixed(16),
              ((y + h / 2) / height).toFixed(16),
              (w / width).toFixed(16),
              (h / height).toFixed(16),
            ];
            
            // Ensure keypoints array is the correct length
            const singleAnimalKeypoints = ann.keypoints || [];
            const keypointsNorm = [];
            for (let i = 0; i < keypointLabels.length; i++) {
              const pt = singleAnimalKeypoints[i];
              if (pt && pt.x !== undefined && pt.y !== undefined) {
                keypointsNorm.push({
                  x: (pt.x / width).toFixed(16),
                  y: (pt.y / height).toFixed(16),
                });
              } else {
                keypointsNorm.push({ x: 0, y: 0 });
              }
            }
            
            const singleAnimalVisibilities = ann.visibilities || [];
            const visibilities = [];
            for (let i = 0; i < keypointLabels.length; i++) {
              const vis = singleAnimalVisibilities[i];
              if (vis !== undefined) {
                visibilities.push(vis);
              } else if (singleAnimalKeypoints[i] && singleAnimalKeypoints[i].x !== undefined) {
                visibilities.push(2); // Default to visible if keypoint exists
              } else {
                visibilities.push(0); // Not labeled
              }
            }
            
            // Use skeleton ID
            const skeletonId = ann.skeletonId !== undefined ? ann.skeletonId : 0;
            const yoloLine = annotationToYOLO(skeletonId, bboxNorm, keypointsNorm, visibilities);
            yoloLines.push(yoloLine);
          }
        }
        
        // Handle bbox separately if it has a different ID than skeleton, or if there's no skeleton
        if (ann.bbox) {
          const hasKeypoints = ann.keypoints && ann.keypoints.some(pt => pt !== null);
          const skeletonId = ann.skeletonId !== undefined ? ann.skeletonId : 0;
          const bboxId = ann.bboxId !== undefined ? ann.bboxId : 0;
          
          // Only create separate bbox entry if:
          // 1. There are no keypoints (bbox-only), or
          // 2. Bbox ID is different from skeleton ID
          if (!hasKeypoints || bboxId !== skeletonId) {
            const [x, y, w, h] = ann.bbox;
            const bboxNorm = [
              ((x + w / 2) / width).toFixed(16),
              ((y + h / 2) / height).toFixed(16),
              (w / width).toFixed(16),
              (h / height).toFixed(16),
            ];
            
            // Empty keypoints for bbox-only annotation
            const keypointsNorm = Array(keypointLabels.length).fill({ x: 0, y: 0 });
            const visibilities = Array(keypointLabels.length).fill(0); // All not labeled
            
            const yoloLine = annotationToYOLO(bboxId, bboxNorm, keypointsNorm, visibilities);
            yoloLines.push(yoloLine);
          }
        }
      }
      
      // Save label file with all YOLO lines
      if (yoloLines.length > 0) {
        labelsDir.file(`${baseName}.txt`, yoloLines.join('\n') + '\n');
      }
    }
    
    // Download as zip
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = isVideo ? `${baseDir}_annotations.zip` : 'annotations.zip';
    a.click();
  };

  return (
    <div className="video-annotator">
      {showKeypointConfigModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ 
            background: 'var(--bg-secondary)', 
            padding: 32, 
            borderRadius: 12, 
            minWidth: 600,
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            color: 'var(--text-primary)'
          }}>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: 24 }}>Select Keypoint Configuration</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Object.entries(allKeypointConfigs).map(([key, config]) => {
                const isCustom = !(key in KEYPOINT_CONFIGS);
                const isExpanded = expandedConfigs.has(key);
                
                return (
                  <div key={key} style={{ 
                    border: '2px solid #e0e0e0',
                    borderRadius: 8,
                    backgroundColor: currentKeypointConfig === key ? '#e3f2fd' : '#f9f9f9',
                    borderColor: currentKeypointConfig === key ? '#2196f3' : '#e0e0e0'
                  }}>
                    {/* Main selection area */}
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12,
                      padding: 16,
                      cursor: 'pointer',
                    }}>
                      <input
                        type="radio"
                        name="keypointConfig"
                        value={key}
                        checked={currentKeypointConfig === key}
                        onChange={() => setCurrentKeypointConfig(key)}
                        style={{ margin: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', color: '#111', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {config.name}
                          {isCustom && (
                            <span style={{ 
                              background: '#e8f5e8', 
                              color: '#2e7d32', 
                              padding: '2px 6px', 
                              borderRadius: 4, 
                              fontSize: '0.7rem',
                              fontWeight: 'normal'
                            }}>
                              Custom
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#111' }}>
                          {config.keypoints.length} keypoints, {config.skeleton.length} connections
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (confirm(`Delete custom configuration "${config.name}"?`)) {
                                setCustomKeypointConfigs(prev => {
                                  const newConfigs = { ...prev };
                                  delete newConfigs[key];
                                  return newConfigs;
                                });
                                // Switch to default if deleting current config
                                if (currentKeypointConfig === key) {
                                  setCurrentKeypointConfig('avatar');
                                }
                              }
                            }}
                            style={{
                              background: '#ffebee',
                              border: '1px solid #f44336',
                              borderRadius: 4,
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                              color: '#f44336'
                            }}
                          >
                            🗑️
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const newExpanded = new Set(expandedConfigs);
                            if (isExpanded) {
                              newExpanded.delete(key);
                            } else {
                              newExpanded.add(key);
                            }
                            setExpandedConfigs(newExpanded);
                          }}
                          style={{
                            background: 'none',
                            border: '1px solid #ccc',
                            borderRadius: 4,
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            color: '#111'
                          }}
                        >
                          {isExpanded ? '▼ Hide' : '▶ Details'}
                        </button>
                      </div>
                    </label>
                    
                    {/* Collapsible details */}
                    {isExpanded && (
                      <div style={{ 
                        padding: '0 16px 16px 16px',
                        borderTop: '1px solid #e0e0e0',
                        marginTop: 8
                      }}>
                        <div style={{ marginBottom: 12 }}>
                          <h4 style={{ margin: '8px 0 4px 0', color: '#111', fontSize: '0.9rem' }}>
                            Keypoints ({config.keypoints.length}):
                          </h4>
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', 
                            gap: 4,
                            fontSize: '0.75rem',
                            color: '#111'
                          }}>
                            {config.keypoints.map((keypoint, idx) => (
                              <div key={idx} style={{ 
                                padding: '2px 6px',
                                background: '#f5f5f5',
                                borderRadius: 3,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                              }}>
                                <span style={{ 
                                  background: '#ddd', 
                                  borderRadius: '50%', 
                                  width: 14, 
                                  height: 14, 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  fontSize: '0.65rem',
                                  fontWeight: 'bold',
                                  color: '#111'
                                }}>
                                  {idx}
                                </span>
                                <span style={{ color: '#111' }}>{keypoint}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <h4 style={{ margin: '8px 0 4px 0', color: '#111', fontSize: '0.9rem' }}>
                            Skeleton Connections ({config.skeleton.length}):
                          </h4>
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                            gap: 4,
                            fontSize: '0.75rem',
                            color: '#111'
                          }}>
                            {config.skeleton.map((connection, idx) => {
                              const [idx1, idx2] = connection;
                              return (
                                <div key={idx} style={{ 
                                  padding: '2px 6px',
                                  background: '#f0f8ff',
                                  borderRadius: 3,
                                  border: '1px solid #e0e8f0',
                                  color: '#111'
                                }}>
                                  {config.keypoints[idx1]} ↔ {config.keypoints[idx2]}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Export/Import Section */}
            <div style={{ 
              marginTop: 24, 
              padding: '16px', 
              background: '#f8f9fa', 
              borderRadius: 8, 
              borderTop: '1px solid #e0e0e0' 
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#111', fontSize: '0.9rem' }}>
                Import/Export Configuration
              </h4>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  onClick={handleExportKeypointConfig}
                  style={{ 
                    color: '#111', 
                    background: '#e3f2fd', 
                    border: '1px solid #2196f3', 
                    padding: '6px 16px', 
                    borderRadius: 4, 
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  📤 Export Current
                </button>
                <label style={{
                  color: '#111', 
                  background: '#e8f5e8', 
                  border: '1px solid #4caf50', 
                  padding: '6px 16px', 
                  borderRadius: 4, 
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}>
                  📥 Import Config
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportKeypointConfig}
                    style={{ display: 'none' }}
                  />
                </label>
                <div style={{ fontSize: '0.8rem', color: '#111', marginLeft: 'auto' }}>
                  Exports {allKeypointConfigs[currentKeypointConfig]?.name} configuration
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                onClick={() => handleKeypointConfigChange(currentKeypointConfig)}
                style={{ 
                  color: '#111', 
                  background: '#f7f7f7', 
                  border: '1px solid #ccc', 
                  padding: '8px 24px', 
                  borderRadius: 6, 
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Apply
              </button>
              <button
                onClick={() => setShowKeypointConfigModal(false)}
                style={{ 
                  color: '#111', 
                  background: '#fff', 
                  border: '1px solid #ccc', 
                  padding: '8px 24px', 
                  borderRadius: 6, 
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ background: 'white', padding: 32, borderRadius: 12, minWidth: 320 }}>
            {modalView === 'stride' ? (
              <>
                <h2 style={{ color: '#111' }}>Video Frame Extraction</h2>
                <div style={{ color: '#111', marginBottom: 12 }}>
                  <div>FPS: <b>{videoMeta.fps}</b></div>
                  <div>Duration: <b>{videoMeta.duration.toFixed(2)}s</b></div>
                  <div style={{ marginTop: 12 }}>
                    <label style={{ display: 'block', marginBottom: 8, color: '#111' }}>Stride (frames):</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range"
                        min={1}
                        max={Math.max(1, Math.floor(videoMeta.duration * videoMeta.fps))}
                        value={stride}
                        onChange={e => handleStrideChange(Number(e.target.value))}
                        style={{ width: 180 }}
                      />
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, Math.floor(videoMeta.duration * videoMeta.fps))}
                        value={stride}
                        onChange={e => handleStrideChange(Math.max(1, Number(e.target.value) || 1))}
                        style={{ 
                          width: 80, 
                          padding: '4px 8px', 
                          border: inputMode === 'stride' ? '2px solid #2196f3' : '1px solid #ccc', 
                          borderRadius: 4,
                          fontSize: 14,
                          backgroundColor: '#f9f9f9',
                          color: '#333'
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#111' }}>Total frames to extract:</label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, Math.floor(videoMeta.duration * videoMeta.fps))}
                      value={targetFrames}
                      onChange={e => handleTargetFramesChange(Math.max(1, Number(e.target.value) || 1))}
                      style={{ 
                        width: 80, 
                        padding: '4px 8px', 
                        border: inputMode === 'frames' ? '2px solid #2196f3' : '1px solid #ccc', 
                        borderRadius: 4,
                        fontSize: 14,
                        backgroundColor: '#f9f9f9',
                        color: '#333'
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ color: '#111' }}>🎲 Random Frame Sampling</h2>
                <div style={{ color: '#111', marginBottom: 12 }}>
                  <div>FPS: <b>{videoMeta.fps}</b></div>
                  <div>Duration: <b>{videoMeta.duration.toFixed(2)}s</b></div>
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#111', fontWeight: 'bold' }}>Frames to sample:</label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, Math.floor(videoMeta.duration * videoMeta.fps))}
                      value={randomFrameCount}
                      onChange={e => handleRandomFrameCountChange(Math.max(1, Number(e.target.value) || 1))}
                      style={{ 
                        width: 80, 
                        padding: '4px 8px', 
                        border: '2px solid #2196f3', 
                        borderRadius: 4,
                        fontSize: 14,
                        backgroundColor: '#f9f9f9',
                        color: '#333'
                      }}
                    />
                  </div>
                </div>
              </>
            )}
            {extracting && (
              <div style={{ marginTop: 12 }}>
                <div style={{ width: '100%', background: '#eee', borderRadius: 4, height: 12, marginBottom: 4 }}>
                  <div style={{ width: extractProgress + '%', background: '#4caf50', height: 12, borderRadius: 4 }}></div>
                </div>
                <div style={{ color: '#111', fontSize: 13 }}>{extractProgress}% extracting frames...</div>
              </div>
            )}
            {extractError && (
              <div style={{ color: 'red', marginTop: 8 }}>{extractError}</div>
            )}
            {modalView === 'stride' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={extractFrames}
                    disabled={extracting}
                    style={{ 
                      color: '#111', 
                      background: '#f7f7f7', 
                      border: '1px solid #ccc', 
                      padding: '8px 24px', 
                      borderRadius: 6, 
                      fontWeight: 600,
                      cursor: extracting ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {extracting ? 'Extracting...' : 'OK'}
                  </button>
                  <button
                    onClick={() => {
                      setShowModal(false);
                      setPendingVideo(null);
                      setPendingUrl(null);
                      setExtractError('');
                      setExtractProgress(0);
                      setModalView('stride');
                    }}
                    disabled={extracting}
                    style={{ 
                      color: '#666', 
                      background: '#fff', 
                      border: '1px solid #ccc', 
                      padding: '8px 24px', 
                      borderRadius: 6, 
                      fontWeight: 600,
                      cursor: extracting ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <button
                  onClick={() => setModalView('random')}
                  disabled={extracting}
                  style={{ 
                    color: '#2196f3', 
                    background: '#f0f8ff', 
                    border: '1px solid #2196f3', 
                    padding: '6px 16px', 
                    borderRadius: 6, 
                    fontWeight: 600,
                    cursor: extracting ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  🎲 Random
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button
                  onClick={extractFrames}
                  disabled={extracting}
                  style={{ 
                    color: '#111', 
                    background: '#f7f7f7', 
                    border: '1px solid #ccc', 
                    padding: '8px 24px', 
                    borderRadius: 6, 
                    fontWeight: 600,
                    cursor: extracting ? 'not-allowed' : 'pointer'
                  }}
                >
                  {extracting ? 'Extracting...' : 'OK'}
                </button>
                <button
                  onClick={() => setModalView('stride')}
                  disabled={extracting}
                  style={{ 
                    color: '#666', 
                    background: '#fff', 
                    border: '1px solid #ccc', 
                    padding: '8px 24px', 
                    borderRadius: 6, 
                    fontWeight: 600,
                    cursor: extracting ? 'not-allowed' : 'pointer'
                  }}
                >
                  Return
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {showLoadModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ 
            background: 'white', 
            padding: 32, 
            borderRadius: 12, 
            minWidth: 500,
            maxWidth: '80vw',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <h2 style={{ color: '#111', marginBottom: 24 }}>Load Annotations</h2>
            
            <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
              {/* Images Section */}
              <div style={{ flex: 1 }}>
                <h3 style={{ color: '#111', marginBottom: 12 }}>Images</h3>
                <label style={{ 
                  display: 'block', 
                  padding: '12px 20px', 
                  border: '2px dashed #ccc', 
                  borderRadius: 8, 
                  textAlign: 'center', 
                  cursor: 'pointer',
                  backgroundColor: '#f9f9f9',
                  marginBottom: 8,
                  color: '#111'
                }}>
                  🖼️ Select Image Files
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageFilesSelect}
                    style={{ display: 'none' }}
                  />
                </label>
                <div style={{ 
                  fontSize: '0.8rem', 
                  color: '#666', 
                  textAlign: 'center',
                  marginBottom: 12,
                  fontStyle: 'italic'
                }}>
                </div>
                
                {/* Image File List */}
                {loadImageFiles.length > 0 && (
                  <div style={{ 
                    marginTop: 12, 
                    padding: 12, 
                    background: '#f5f5f5', 
                    borderRadius: 6,
                    maxHeight: 200,
                    overflow: 'auto'
                  }}>
                    {loadImageDirectory && (
                      <div style={{ fontWeight: 'bold', color: '#111', marginBottom: 8 }}>
                        📁 From: {loadImageDirectory}/
                      </div>
                    )}
                    <div style={{ color: '#111', fontWeight: 'bold', marginBottom: 8 }}>
                      ✅ {loadImageFiles.length} image{loadImageFiles.length !== 1 ? 's' : ''} selected
                    </div>
                    {loadImageFiles.slice(0, 5).map((file, idx) => (
                      <div key={idx} style={{ color: '#666', fontSize: '0.9rem', paddingLeft: loadImageDirectory ? 16 : 0 }}>
                        🖼️ {file.name}
                      </div>
                    ))}
                    {loadImageFiles.length > 5 && (
                      <div style={{ color: '#888', fontSize: '0.8rem', fontStyle: 'italic', paddingLeft: loadImageDirectory ? 16 : 0 }}>
                        ... and {loadImageFiles.length - 5} more files
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Labels Section */}
              <div style={{ flex: 1 }}>
                <h3 style={{ color: '#111', marginBottom: 12 }}>Labels</h3>
                <label style={{ 
                  display: 'block', 
                  padding: '12px 20px', 
                  border: '2px dashed #ccc', 
                  borderRadius: 8, 
                  textAlign: 'center', 
                  cursor: 'pointer',
                  backgroundColor: '#f9f9f9',
                  marginBottom: 8,
                  color: '#111'
                }}>
                  📄 Select Label Files (.txt)
                  <input
                    type="file"
                    accept=".txt"
                    multiple
                    onChange={handleLabelFilesSelect}
                    style={{ display: 'none' }}
                  />
                </label>
                <div style={{ 
                  fontSize: '0.8rem', 
                  color: '#666', 
                  textAlign: 'center',
                  marginBottom: 12,
                  fontStyle: 'italic'
                }}>
                </div>
                
                {/* Label File List */}
                {loadLabelFiles.length > 0 && (
                  <div style={{ 
                    marginTop: 12, 
                    padding: 12, 
                    background: '#f5f5f5', 
                    borderRadius: 6,
                    maxHeight: 200,
                    overflow: 'auto'
                  }}>
                    {loadLabelDirectory && (
                      <div style={{ fontWeight: 'bold', color: '#111', marginBottom: 8 }}>
                        📁 From: {loadLabelDirectory}/
                      </div>
                    )}
                    <div style={{ color: '#111', fontWeight: 'bold', marginBottom: 8 }}>
                      ✅ {loadLabelFiles.length} label{loadLabelFiles.length !== 1 ? 's' : ''} selected
                    </div>
                    {loadLabelFiles.slice(0, 5).map((file, idx) => (
                      <div key={idx} style={{ color: '#666', fontSize: '0.9rem', paddingLeft: loadLabelDirectory ? 16 : 0 }}>
                        📄 {file.name}
                      </div>
                    ))}
                    {loadLabelFiles.length > 5 && (
                      <div style={{ color: '#888', fontSize: '0.8rem', fontStyle: 'italic', paddingLeft: loadLabelDirectory ? 16 : 0 }}>
                        ... and {loadLabelFiles.length - 5} more files
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {loadError && (
              <div style={{ color: 'red', marginBottom: 16, padding: 8, background: '#ffebee', borderRadius: 4 }}>
                {loadError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={processLoadedAnnotations}
                disabled={loadImageFiles.length === 0}
                style={{ 
                  color: '#111', 
                  background: loadImageFiles.length === 0 ? '#f5f5f5' : '#f7f7f7', 
                  border: '1px solid #ccc', 
                  padding: '8px 24px', 
                  borderRadius: 6, 
                  fontWeight: 600,
                  cursor: loadImageFiles.length === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                Load Annotations
              </button>
              <button
                onClick={() => {
                  setShowLoadModal(false);
                  setLoadImageFiles([]);
                  setLoadLabelFiles([]);
                  setLoadImageDirectory('');
                  setLoadLabelDirectory('');
                  setLoadError('');
                }}
                style={{ 
                  color: '#666', 
                  background: '#fff', 
                  border: '1px solid #ccc', 
                  padding: '8px 24px', 
                  borderRadius: 6, 
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Dark Mode Button - OUTSIDE media area, positioned above top-right */}
      <div style={{ 
        position: 'relative', 
        marginBottom: '0.5rem',
        display: 'flex',
        justifyContent: 'flex-end'
      }}>
        <button
          onClick={() => setDarkMode(!darkMode)}
          style={{
            background: darkMode ? 'rgba(66, 66, 66, 0.95)' : 'rgba(255,255,255,0.95)',
            border: darkMode ? '1px solid #444' : '1px solid #ccc',
            borderRadius: 6,
            padding: '8px 16px',
            fontWeight: 600,
            color: darkMode ? '#fff' : '#111',
            cursor: 'pointer',
            fontSize: '0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          {darkMode ? '🌙' : '☀️'} {darkMode ? 'Dark' : 'Light'}
        </button>
      </div>
      
      <div className="media-container">
        {/* Multi-Animal Mode Toggle and Keypoint Settings Buttons - Outside media area */}
        <div className="settings-header">
          <button
            onClick={() => setMultiAnimalMode(!multiAnimalMode)}
            style={{
              background: multiAnimalMode ? 'rgba(76, 175, 80, 0.95)' : 'rgba(255,255,255,0.95)',
              border: multiAnimalMode ? '1px solid #4caf50' : '1px solid #ccc',
              borderRadius: 6,
              padding: '6px 12px',
              fontWeight: 600,
              color: multiAnimalMode ? '#fff' : '#111',
              cursor: 'pointer',
              fontSize: '0.85rem',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              minWidth: '160px'
            }}
          >
            🐾 Multi-Animal {multiAnimalMode ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setShowKeypointConfigModal(true)}
            style={{
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid #ccc',
              borderRadius: 6,
              padding: '6px 12px',
              fontWeight: 600,
              color: '#111',
              cursor: 'pointer',
              fontSize: '0.85rem',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)'
            }}
          >
            ⚙️ Keypoint Settings
          </button>
        </div>

        <div className="media-area-wrapper">
          <div className="media-area">
            {(!imageUrls.length || extracting) && (
              <div style={{ color: '#888', fontSize: 18, textAlign: 'center', width: '100%' }}>
                {extracting ? `Extracting frames... (${extractProgress}%)` : 'No image/video loaded.'}
              </div>
            )}
            {mode === 'keypoint' && (isImageMode || isVideoMode) && imageUrls.length > 0 && (
              <div className="keypoint-indicator">
                {keypointLabel}
              </div>
            )}
            
            {imageUrls.length > 0 && (
              <VideoPlayer
                videoUrl={videoUrl}
                imageUrl={isImageMode ? imageUrls[currentFrame] : null}
                videoRef={videoRef}
                canvasRef={canvasRef}
                annotations={annotations}
                setAnnotations={setAnnotations}
                mode={mode}
                keypointIndex={keypointIndex}
                setKeypointIndex={setKeypointIndex}
                keypointLabels={keypointLabels}
                skeletonConnections={skeletonConnections}
                currentFrame={currentFrame}
                onUndo={handleUndo}
                onRedo={handleRedo}
                setMode={setMode}
                saveToUndoStack={saveToUndoStack}
                currentSkeletonId={currentSkeletonId}
                currentBboxId={currentBboxId}
                selectedBbox={selectedBbox}
                setSelectedBbox={setSelectedBbox}
                selectedSkeleton={selectedSkeleton}
                setSelectedSkeleton={setSelectedSkeleton}
                hoveredSidebarObject={hoveredSidebarObject}
                setHoveredImageObject={setHoveredImageObject}
                selectedImageObjects={selectedImageObjects}
                setSelectedImageObjects={setSelectedImageObjects}
                multiAnimalMode={multiAnimalMode}
                setCurrentSkeletonId={setCurrentSkeletonId}
                setCurrentBboxId={setCurrentBboxId}
                showKeypointLabels={showKeypointLabels}
                ref={videoPlayerRef}
              />
            )}
          </div>
          
          {/* Compact Right Sidebar */}
          <div className="sidebar-compact">
            <div 
              className="sidebar-toggle-compact" 
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                {sidebarExpanded ? '▼' : '▶'} Keypoint Settings: {keypointConfig.name}
              </span>
            </div>
            
            {sidebarExpanded && (
              <div className="sidebar-content-compact">
                {keypointLabels.map((label, index) => (
                  <div 
                    key={index} 
                    className="keypoint-item"
                    style={{
                      background: mode === 'keypoint' && keypointIndex === index ? '#e3f2fd' : 'transparent'
                    }}
                  >
                    <span className="keypoint-index">
                      {index}
                    </span>
                    <span 
                      className="keypoint-label"
                      style={{
                        fontWeight: mode === 'keypoint' && keypointIndex === index ? 500 : 400
                      }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            
            {/* ID Settings Section */}
            <div 
              className="sidebar-toggle-compact" 
              onClick={() => setIdSettingsExpanded(!idSettingsExpanded)}
              style={{ borderTop: '1px solid #e0e0e0' }}
            >
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                {idSettingsExpanded ? '▼' : '▶'} ID Settings
              </span>
            </div>
            
            {idSettingsExpanded && (
              <div className="sidebar-content-compact" style={{ padding: '8px' }}>
                {/* Skeleton Section */}
                <div style={{ marginBottom: '12px' }}>
                  <div 
                    className="sidebar-toggle-compact" 
                    onClick={() => setSkeletonSectionExpanded(!skeletonSectionExpanded)}
                    style={{ 
                      margin: 0, 
                      padding: '8px', 
                      background: '#f0f8ff', 
                      border: '1px solid #e0e8f0',
                      borderRadius: '4px'
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#1976d2' }}>
                      {skeletonSectionExpanded ? '▼' : '▶'} Skeletons
                    </span>
                  </div>
                  
                  {skeletonSectionExpanded && (
                    <div style={{ 
                      padding: '8px', 
                      background: '#fafbfc', 
                      border: '1px solid #e0e8f0',
                      borderTop: 'none',
                      borderRadius: '0 0 4px 4px'
                    }}>
                      {/* List existing skeletons */}
                      {(() => {
                        const skeletons = [];
                        const currentAnn = annotations[currentFrame];
                        
                        // Handle current/working skeleton for current frame only
                        if (currentAnn && currentAnn.keypoints && currentAnn.keypoints.some(pt => pt !== null)) {
                          const skeletonId = currentAnn.skeletonId !== undefined ? currentAnn.skeletonId : 0;
                          skeletons.push({ 
                            id: skeletonId, 
                            frames: [currentFrame], 
                            type: 'working',
                            uniqueKey: `working-${currentFrame}`
                          });
                        }
                        
                        // Handle completed skeletons in multi-animal mode for current frame only
                        if (multiAnimalMode && currentAnn && currentAnn.skeletons) {
                          currentAnn.skeletons.forEach((skeleton, skeletonIndex) => {
                            if (skeleton.keypoints && skeleton.keypoints.some(pt => pt !== null)) {
                              const skeletonId = skeleton.id;
                              skeletons.push({ 
                                id: skeletonId, 
                                frames: [currentFrame], 
                                type: 'completed',
                                skeletonIndex: skeletonIndex,
                                uniqueKey: `completed-${currentFrame}-${skeletonIndex}`
                              });
                            }
                          });
                        }
                        
                        if (skeletons.length === 0) {
                          return (
                            <div style={{ 
                              fontSize: '0.7rem', 
                              color: '#888', 
                              fontStyle: 'italic',
                              textAlign: 'center',
                              padding: '8px'
                            }}>
                              No skeletons created yet
                            </div>
                          );
                        }
                        
                        return skeletons.map(skeleton => {
                          const isCurrentFrame = skeleton.frames.includes(currentFrame);
                          const currentAnn = annotations[currentFrame] || {};
                          const skeletonObjKey = skeleton.type === 'completed' ? `completed_skeleton_${skeleton.skeletonIndex}` : 'working_skeleton';
                          const isSelected = multiAnimalMode ? selectedImageObjects.has(skeletonObjKey) : (selectedSkeleton && isCurrentFrame);
                          const isIdTextboxHovered = hoveredIdTextbox && hoveredIdTextbox.type === 'skeleton' && hoveredIdTextbox.objKey === skeletonObjKey;
                          const shouldHighlight = isSelected || isIdTextboxHovered;
                          
                          return (
                            <div 
                              key={skeleton.uniqueKey}
                              style={{ 
                                padding: '6px',
                                marginBottom: '4px',
                                background: shouldHighlight ? '#e3f2fd' : '#fff',
                                border: shouldHighlight ? '1px solid #2196f3' : '1px solid #ddd',
                                borderRadius: '3px',
                                cursor: isCurrentFrame ? 'pointer' : 'default',
                                opacity: isCurrentFrame ? 1 : 0.6
                              }}
                              onMouseEnter={() => {
                                setHoveredSidebarObject({
                                  type: 'skeleton', 
                                  id: skeleton.id,
                                  objKey: skeleton.type === 'completed' ? `completed_skeleton_${skeleton.skeletonIndex}` : 'working_skeleton',
                                  position: skeleton.type === 'completed' ? skeleton.skeletonIndex : null
                                });
                                setHoveredIdTextbox({
                                  type: 'skeleton',
                                  objKey: skeleton.type === 'completed' ? `completed_skeleton_${skeleton.skeletonIndex}` : 'working_skeleton'
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredSidebarObject(null);
                                setHoveredIdTextbox(null);
                              }}
                              onClick={() => {
                                if (isCurrentFrame) {
                                  if (multiAnimalMode) {
                                    // Multi-animal mode: exclusive selection (replace current selection)
                                    const skeletonObjKey = skeleton.type === 'completed' ? `completed_skeleton_${skeleton.skeletonIndex}` : 'working_skeleton';
                                    const isCurrentlySelected = selectedImageObjects.has(skeletonObjKey);
                                    
                                    if (isCurrentlySelected) {
                                      // If clicking on already selected object, deselect it
                                      setSelectedImageObjects(new Set());
                                    } else {
                                      // Replace current selection with this object
                                      setSelectedImageObjects(new Set([skeletonObjKey]));
                                    }
                                    selectedKeypoints.current.clear();
                                    
                                    // Trigger immediate redraw in VideoPlayer
                                    if (videoPlayerRef.current) {
                                      videoPlayerRef.current.draw();
                                    }
                                  } else {
                                    // Single animal mode: exclusive selection (replace current selection)
                                    const isCurrentlySelected = selectedSkeleton;
                                    
                                    if (isCurrentlySelected) {
                                      // If clicking on already selected skeleton, deselect it
                                      setSelectedSkeleton(false);
                                    } else {
                                      // Replace current selection with this skeleton
                                      setSelectedSkeleton(true);
                                      setSelectedBbox(false); // Clear bbox selection
                                    }
                                    selectedKeypoints.current.clear();
                                    
                                    // Trigger immediate redraw in VideoPlayer
                                    if (videoPlayerRef.current) {
                                      videoPlayerRef.current.draw();
                                    }
                                  }
                                }
                              }}
                            >
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                marginBottom: '4px'
                              }}>
                                <span style={{ 
                                  fontSize: '0.75rem', 
                                  fontWeight: 500,
                                  color: isCurrentFrame ? '#111' : '#666'
                                }}>
                                  Skeleton ID: {skeleton.id}
                                  {multiAnimalMode && skeleton.type === 'working' && (
                                    <span style={{ 
                                      fontSize: '0.6rem', 
                                      color: '#666', 
                                      marginLeft: '4px',
                                      fontStyle: 'italic' 
                                    }}>
                                      (working)
                                    </span>
                                  )}
                                </span>
                                {isCurrentFrame && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAnnotations(prev => {
                                        const next = [...prev];
                                        const ann = next[currentFrame] || {};
                                        
                                        if (multiAnimalMode && skeleton.type === 'completed') {
                                          // Multi-animal mode: toggle specific completed skeleton
                                          if (ann.skeletons && skeleton.skeletonIndex !== undefined) {
                                            const skeletons = [...ann.skeletons];
                                            if (skeletons[skeleton.skeletonIndex]) {
                                              skeletons[skeleton.skeletonIndex] = {
                                                ...skeletons[skeleton.skeletonIndex],
                                                hidden: !skeletons[skeleton.skeletonIndex].hidden
                                              };
                                              next[currentFrame] = { ...ann, skeletons };
                                            }
                                          }
                                        } else {
                                          // Single animal mode or working skeleton
                                          next[currentFrame] = { 
                                            ...ann, 
                                            skeletonHidden: !ann.skeletonHidden 
                                          };
                                        }
                                        
                                        return next;
                                      });
                                    }}
                                    style={{
                                      background: (multiAnimalMode && skeleton.type === 'completed' && 
                                                 currentAnn.skeletons && currentAnn.skeletons[skeleton.skeletonIndex]?.hidden) ||
                                                (!multiAnimalMode && currentAnn.skeletonHidden) ||
                                                (multiAnimalMode && skeleton.type === 'working' && currentAnn.skeletonHidden)
                                                ? '#ff4444' : '#666',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '2px',
                                      padding: '2px 4px',
                                      fontSize: '0.6rem',
                                      cursor: 'pointer',
                                      minWidth: '35px'
                                    }}
                                    title={(multiAnimalMode && skeleton.type === 'completed' && 
                                           currentAnn.skeletons && currentAnn.skeletons[skeleton.skeletonIndex]?.hidden) ||
                                          (!multiAnimalMode && currentAnn.skeletonHidden) ||
                                          (multiAnimalMode && skeleton.type === 'working' && currentAnn.skeletonHidden)
                                          ? 'Show skeleton' : 'Hide skeleton'}
                                  >
                                    {(multiAnimalMode && skeleton.type === 'completed' && 
                                     currentAnn.skeletons && currentAnn.skeletons[skeleton.skeletonIndex]?.hidden) ||
                                    (!multiAnimalMode && currentAnn.skeletonHidden) ||
                                    (multiAnimalMode && skeleton.type === 'working' && currentAnn.skeletonHidden)
                                    ? 'Show' : 'Hide'}
                                  </button>
                                )}
                              </div>
                              
                              {isCurrentFrame && (
                                <input
                                  type="number"
                                  min="0"
                                  max="999"
                                  value={skeleton.id}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    const newId = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
                                    
                                    setAnnotations(prev => {
                                      const next = [...prev];
                                      const ann = next[currentFrame] || {};
                                      
                                      if (multiAnimalMode) {
                                        // In multi-animal mode, update specific skeleton based on type
                                        let updatedAnn = { ...ann };
                                        
                                        if (skeleton.type === 'working') {
                                          // Update working skeleton ID
                                          updatedAnn.skeletonId = newId;
                                        } else if (skeleton.type === 'completed') {
                                          // Update specific completed skeleton ID
                                          if (ann.skeletons && skeleton.skeletonIndex !== undefined) {
                                            const skeletons = [...ann.skeletons];
                                            if (skeletons[skeleton.skeletonIndex]) {
                                              skeletons[skeleton.skeletonIndex] = { 
                                                ...skeletons[skeleton.skeletonIndex], 
                                                id: newId 
                                              };
                                              updatedAnn.skeletons = skeletons;
                                            }
                                          }
                                        }
                                        
                                        next[currentFrame] = updatedAnn;
                                      } else {
                                        // Single animal mode - just update working skeleton
                                        next[currentFrame] = { ...ann, skeletonId: newId };
                                      }
                                      
                                      return next;
                                    });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onFocus={(e) => e.target.select()}

                                  style={{
                                    width: '100%',
                                    padding: '3px 5px',
                                    border: hoveredImageObject && hoveredImageObject.type === 'skeleton' && hoveredImageObject.objKey === skeletonObjKey 
                                      ? '2px solid #2196f3' 
                                      : '1px solid #2196f3',
                                    borderRadius: '2px',
                                    fontSize: '0.7rem',
                                    boxSizing: 'border-box',
                                    color: '#111',
                                    backgroundColor: hoveredImageObject && hoveredImageObject.type === 'skeleton' && hoveredImageObject.objKey === skeletonObjKey 
                                      ? '#e3f2fd' 
                                      : '#fff'
                                  }}
                                />
                              )}

                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
                
                {/* Bbox Section */}
                <div style={{ marginBottom: '12px' }}>
                  <div 
                    className="sidebar-toggle-compact" 
                    onClick={() => setBboxSectionExpanded(!bboxSectionExpanded)}
                    style={{ 
                      margin: 0, 
                      padding: '8px', 
                      background: '#fff8e1', 
                      border: '1px solid #ffe0b2',
                      borderRadius: '4px'
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#f57c00' }}>
                      {bboxSectionExpanded ? '▼' : '▶'} Bounding Boxes
                    </span>
                  </div>
                  
                  {bboxSectionExpanded && (
                    <div style={{ 
                      padding: '8px', 
                      background: '#fffcf7', 
                      border: '1px solid #ffe0b2',
                      borderTop: 'none',
                      borderRadius: '0 0 4px 4px'
                    }}>

                      
                      {/* List existing bboxes */}
                      {(() => {
                        const bboxes = [];
                        const currentAnn = annotations[currentFrame];
                        
                        // Handle current/working bbox for current frame only
                        if (currentAnn && currentAnn.bbox && currentAnn.bbox.length === 4) {
                          const bboxId = currentAnn.bboxId !== undefined ? currentAnn.bboxId : 0;
                          bboxes.push({ 
                            id: bboxId, 
                            frames: [currentFrame], 
                            type: 'working',
                            uniqueKey: `working-${currentFrame}`
                          });
                        }
                        
                        // Handle completed bboxes in multi-animal mode for current frame only
                        if (multiAnimalMode && currentAnn && currentAnn.bboxes) {
                          currentAnn.bboxes.forEach((bbox, bboxIndex) => {
                            if (bbox.bbox && bbox.bbox.length === 4) {
                              const bboxId = bbox.id;
                              bboxes.push({ 
                                id: bboxId, 
                                frames: [currentFrame], 
                                type: 'completed', 
                                bboxIndex: bboxIndex,
                                uniqueKey: `completed-${currentFrame}-${bboxIndex}`
                              });
                            }
                          });
                        }
                        
                        if (bboxes.length === 0) {
                          return (
                            <div style={{ 
                              fontSize: '0.7rem', 
                              color: '#888', 
                              fontStyle: 'italic',
                              textAlign: 'center',
                              padding: '8px'
                            }}>
                              No bounding boxes created yet
                            </div>
                          );
                        }
                        
                        return bboxes.map(bbox => {
                          const isCurrentFrame = bbox.frames.includes(currentFrame);
                          const currentAnn = annotations[currentFrame] || {};
                          const bboxObjKey = bbox.type === 'completed' ? `completed_bbox_${bbox.bboxIndex}` : 'working_bbox';
                          const isSelected = multiAnimalMode ? selectedImageObjects.has(bboxObjKey) : (selectedBbox && isCurrentFrame);
                          const isIdTextboxHovered = hoveredIdTextbox && hoveredIdTextbox.type === 'bbox' && hoveredIdTextbox.objKey === bboxObjKey;
                          const shouldHighlight = isSelected || isIdTextboxHovered;
                          
                          return (
                            <div 
                              key={bbox.uniqueKey}
                              style={{ 
                                padding: '6px',
                                marginBottom: '4px',
                                background: shouldHighlight ? '#fff3e0' : '#fff',
                                border: shouldHighlight ? '1px solid #ff9800' : '1px solid #ddd',
                                borderRadius: '3px',
                                cursor: isCurrentFrame ? 'pointer' : 'default',
                                opacity: isCurrentFrame ? 1 : 0.6
                              }}
                              onMouseEnter={() => {
                                setHoveredSidebarObject({
                                  type: 'bbox', 
                                  id: bbox.id,
                                  objKey: bbox.type === 'completed' ? `completed_bbox_${bbox.bboxIndex}` : 'working_bbox',
                                  position: bbox.type === 'completed' ? bbox.bboxIndex : null
                                });
                                setHoveredIdTextbox({
                                  type: 'bbox',
                                  objKey: bbox.type === 'completed' ? `completed_bbox_${bbox.bboxIndex}` : 'working_bbox'
                                });
                              }}
                              onMouseLeave={() => {
                                setHoveredSidebarObject(null);
                                setHoveredIdTextbox(null);
                              }}
                              onClick={() => {
                                if (isCurrentFrame) {
                                  if (multiAnimalMode) {
                                    // Multi-animal mode: exclusive selection (replace current selection)
                                    const bboxObjKey = bbox.type === 'completed' ? `completed_bbox_${bbox.bboxIndex}` : 'working_bbox';
                                    const isCurrentlySelected = selectedImageObjects.has(bboxObjKey);
                                    
                                    if (isCurrentlySelected) {
                                      // If clicking on already selected object, deselect it
                                      setSelectedImageObjects(new Set());
                                    } else {
                                      // Replace current selection with this object
                                      setSelectedImageObjects(new Set([bboxObjKey]));
                                    }
                                    selectedKeypoints.current.clear();
                                    
                                    // Trigger immediate redraw in VideoPlayer
                                    if (videoPlayerRef.current) {
                                      videoPlayerRef.current.draw();
                                    }
                                  } else {
                                    // Single animal mode: exclusive selection (replace current selection)
                                    const isCurrentlySelected = selectedBbox;
                                    
                                    if (isCurrentlySelected) {
                                      // If clicking on already selected bbox, deselect it
                                      setSelectedBbox(false);
                                    } else {
                                      // Replace current selection with this bbox
                                      setSelectedBbox(true);
                                      setSelectedSkeleton(false); // Clear skeleton selection
                                    }
                                    selectedKeypoints.current.clear();
                                    
                                    // Trigger immediate redraw in VideoPlayer
                                    if (videoPlayerRef.current) {
                                      videoPlayerRef.current.draw();
                                    }
                                  }
                                }
                              }}
                            >
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                marginBottom: '4px'
                              }}>
                                <span style={{ 
                                  fontSize: '0.75rem', 
                                  fontWeight: 500,
                                  color: isCurrentFrame ? '#111' : '#666'
                                }}>
                                  Bbox ID: {bbox.id}
                                  {multiAnimalMode && bbox.type === 'working' && (
                                    <span style={{ 
                                      fontSize: '0.6rem', 
                                      color: '#666', 
                                      marginLeft: '4px',
                                      fontStyle: 'italic' 
                                    }}>
                                      (working)
                                    </span>
                                  )}
                                </span>
                                {isCurrentFrame && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAnnotations(prev => {
                                        const next = [...prev];
                                        const ann = next[currentFrame] || {};
                                        
                                        if (multiAnimalMode && bbox.type === 'completed') {
                                          // Multi-animal mode: toggle specific completed bbox
                                          if (ann.bboxes && bbox.bboxIndex !== undefined) {
                                            const bboxes = [...ann.bboxes];
                                            if (bboxes[bbox.bboxIndex]) {
                                              bboxes[bbox.bboxIndex] = {
                                                ...bboxes[bbox.bboxIndex],
                                                hidden: !bboxes[bbox.bboxIndex].hidden
                                              };
                                              next[currentFrame] = { ...ann, bboxes };
                                            }
                                          }
                                        } else {
                                          // Single animal mode or working bbox
                                          next[currentFrame] = { 
                                            ...ann, 
                                            bboxHidden: !ann.bboxHidden 
                                          };
                                        }
                                        
                                        return next;
                                      });
                                    }}
                                    style={{
                                      background: (multiAnimalMode && bbox.type === 'completed' && 
                                                 currentAnn.bboxes && currentAnn.bboxes[bbox.bboxIndex]?.hidden) ||
                                                (!multiAnimalMode && currentAnn.bboxHidden) ||
                                                (multiAnimalMode && bbox.type === 'working' && currentAnn.bboxHidden)
                                                ? '#ff4444' : '#666',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '2px',
                                      padding: '2px 4px',
                                      fontSize: '0.6rem',
                                      cursor: 'pointer',
                                      minWidth: '35px'
                                    }}
                                    title={(multiAnimalMode && bbox.type === 'completed' && 
                                           currentAnn.bboxes && currentAnn.bboxes[bbox.bboxIndex]?.hidden) ||
                                          (!multiAnimalMode && currentAnn.bboxHidden) ||
                                          (multiAnimalMode && bbox.type === 'working' && currentAnn.bboxHidden)
                                          ? 'Show bbox' : 'Hide bbox'}
                                  >
                                    {(multiAnimalMode && bbox.type === 'completed' && 
                                     currentAnn.bboxes && currentAnn.bboxes[bbox.bboxIndex]?.hidden) ||
                                    (!multiAnimalMode && currentAnn.bboxHidden) ||
                                    (multiAnimalMode && bbox.type === 'working' && currentAnn.bboxHidden)
                                    ? 'Show' : 'Hide'}
                                  </button>
                                )}
                              </div>
                              
                              {isCurrentFrame && (
                                <input
                                  type="number"
                                  min="0"
                                  max="999"
                                  value={bbox.id}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    const newId = value === '' ? 0 : Math.max(0, parseInt(value) || 0);
                                    
                                    setAnnotations(prev => {
                                      const next = [...prev];
                                      const ann = next[currentFrame] || {};
                                      
                                      if (multiAnimalMode && bbox.type === 'completed') {
                                        // Update specific completed bbox in multi-animal mode
                                        if (ann.bboxes && bbox.bboxIndex !== undefined) {
                                          const bboxes = [...ann.bboxes];
                                          if (bboxes[bbox.bboxIndex]) {
                                            bboxes[bbox.bboxIndex] = { 
                                              ...bboxes[bbox.bboxIndex], 
                                              id: newId 
                                            };
                                            next[currentFrame] = { ...ann, bboxes: bboxes };
                                          }
                                        }
                                      } else {
                                        // Update working bbox (single-animal mode or working bbox in multi-animal mode)
                                        next[currentFrame] = { ...ann, bboxId: newId };
                                      }
                                      
                                      return next;
                                    });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onFocus={(e) => e.target.select()}

                                  style={{
                                    width: '100%',
                                    padding: '3px 5px',
                                    border: hoveredImageObject && hoveredImageObject.type === 'bbox' && hoveredImageObject.objKey === bboxObjKey 
                                      ? '2px solid #ff6600' 
                                      : '1px solid #ff9800',
                                    borderRadius: '2px',
                                    fontSize: '0.7rem',
                                    boxSizing: 'border-box',
                                    color: '#111',
                                    backgroundColor: hoveredImageObject && hoveredImageObject.type === 'bbox' && hoveredImageObject.objKey === bboxObjKey 
                                      ? '#fff3e0' 
                                      : '#fff'
                                  }}
                                />
                              )}

                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
                
                {/* ID Validation Status */}
                {(() => {
                  const validation = validateIdConsistency();
                  if (!validation.isValid) {
                    return (
                      <div style={{ 
                        marginTop: '8px', 
                        padding: '8px', 
                        background: '#fff3cd', 
                        border: '1px solid #ffeaa7',
                        borderRadius: '4px',
                        fontSize: '0.65rem',
                        color: '#856404'
                      }}>
                        ⚠️ <strong>ID Warnings:</strong><br/>
                        {validation.issues.map((issue, idx) => (
                          <div key={idx} style={{ marginTop: '2px' }}>• {issue}</div>
                        ))}
                      </div>
                    );
                   } else if (annotations.some(ann => {
                     if (!ann) return false;
                     if (multiAnimalMode) {
                       // Multi-animal mode: check for skeletons or bboxes arrays
                       return (ann.skeletons && ann.skeletons.length > 0) || 
                              (ann.bboxes && ann.bboxes.length > 0) ||
                              ann.keypoints || ann.bbox;
                     } else {
                       // Single animal mode: check for frames that have BOTH keypoints AND bbox to compare
                       const hasKeypoints = ann.keypoints && ann.keypoints.some(pt => pt !== null);
                       const hasBbox = ann.bbox && ann.bbox.length === 4;
                       return hasKeypoints && hasBbox;
                     }
                   })) {
                     return (
                       <div style={{ 
                         marginTop: '8px', 
                         padding: '8px', 
                         background: '#d4edda', 
                         border: '1px solid #c3e6cb',
                         borderRadius: '4px',
                         fontSize: '0.65rem',
                         color: '#155724'
                       }}>
                         ✅ All skeleton and bbox IDs match
                       </div>
                     );
                   }
                  return null;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
      <Toolbar
        onVideoLoad={handleVideoLoad}
        onImagesLoad={handleImagesLoad}
        onLoadAnnotations={handleLoadAnnotations}
        onPrevFrame={handlePrevFrame}
        onNextFrame={handleNextFrame}
        onFrameChange={handleFrameChange}
        currentFrame={currentFrame}
        totalFrames={Math.max(1, totalFrames)}
        onExport={handleExport}
        currentImageName={currentImageName}
      />
    </div>
  );
};

export default VideoAnnotator; 