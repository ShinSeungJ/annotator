import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

// ============ CUSTOMIZATION SETTINGS ============
// Change these values to customize keypoint appearance
const KEYPOINT_RADIUS = 4; // Size of keypoint circles
const KEYPOINT_COLOR = 'rgb(255, 56, 56)'; // Color for visible, hidden, and not labeled keypoints
const KEYPOINT_SELECTED_COLOR = '#007bff'; 
const SKELETON_NORMAL_COLOR = 'rgba(255, 165, 0, 0.9)';
const SKELETON_HOVER_COLOR = 'rgba(52, 203, 241, 0.97)';
// ================================================

// Keypoint labels for reference - now dynamic based on configuration

// Create a working circle cursor using a simple approach
const createCircleCursor = () => {
  // Create a small canvas to draw the circle cursor
  const canvasSize = Math.max(32, KEYPOINT_RADIUS * 4); // Make cursor canvas big enough for the circle
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  
  // Draw a circle outline that matches the keypoint size
  ctx.strokeStyle = KEYPOINT_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const center = canvasSize / 2;
  ctx.arc(center, center, KEYPOINT_RADIUS, 0, 2 * Math.PI);
  ctx.stroke();
  
  // Convert to data URL
  const dataURL = canvas.toDataURL('image/png');
  return `url('${dataURL}') ${center} ${center}, crosshair`;
};

const CIRCLE_CURSOR = createCircleCursor();

// Helper to decode the various objKey formats we use in multi-animal mode
// Returns { pattern: 'completed' | 'working' | 'legacy', skeletonIndex, skeletonId, kpIdx }
const getObjKeyInfo = (objKey, frameAnn = null, currentSkeletonId = 0) => {
  if (objKey.startsWith('completed_skeleton_')) {
    const parts = objKey.split('_');
    const skeletonIndex = Number(parts[2]);
    const kpIdx = Number(parts[3]);
    const skeletonId = frameAnn && frameAnn.skeletons && frameAnn.skeletons[skeletonIndex]
      ? frameAnn.skeletons[skeletonIndex].id
      : null;
    return { pattern: 'completed', skeletonIndex, skeletonId, kpIdx };
  }
  if (objKey.startsWith('working_skeleton_')) {
    const kpIdx = Number(objKey.split('_')[2]);
    const skeletonId = frameAnn && (frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId);
    return { pattern: 'working', skeletonIndex: null, skeletonId, kpIdx };
  }
  // legacy "id_idx" pattern (single-animal or very early multi-animal builds)
  const parts = objKey.split('_').map(Number);
  return { pattern: 'legacy', skeletonIndex: null, skeletonId: parts[0], kpIdx: parts[1] };
};

const VideoPlayer = forwardRef(({
  videoUrl,
  imageUrl,
  videoRef,
  canvasRef,
  annotations,
  setAnnotations,
  mode,
  keypointIndex,
  setKeypointIndex,
  keypointLabels,
  skeletonConnections,
  currentFrame,
  setMode,
  saveToUndoStack, // Add this prop
  currentSkeletonId,
  currentBboxId,
  selectedBbox,
  setSelectedBbox,
  selectedSkeleton,
  setSelectedSkeleton,
  hoveredSidebarObject,
  setHoveredImageObject,
  selectedImageObjects,
  setSelectedImageObjects,
  multiAnimalMode,
  setCurrentSkeletonId,
  setCurrentBboxId,
  showKeypointLabels,
}, ref) => {
  const drawing = useRef(false);
  const startPoint = useRef(null);
  const currentBox = useRef(null);
  const draggingKeypoint = useRef(null);
  const draggingBox = useRef(false);
  const scale = useRef(1);
  const offset = useRef({ x: 0, y: 0 });
  const panning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const spacePressed = useRef(false);
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const selectedKeypoint = useRef(null);
  const dragActive = useRef(false);
  const dragStartPos = useRef(null); // For undo/redo optimization
  const selectedBboxRef = useRef(null);
  const bboxDragActive = useRef(false);
  const bboxDragStart = useRef(null);
  const bboxOriginal = useRef(null);
  const hoveredKeypoint = useRef(null);
  const hoveredBbox = useRef(false);
  const hoveredSkeleton = useRef(false);
  const selectedKeypoints = useRef(new Set()); // Set of selected keypoint indices
  const resizingBbox = useRef(false);
  const resizeHandle = useRef(null); // 'nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'
  const resizeStartBbox = useRef(null);
  const resizeBboxInfo = useRef(null); // Store bbox info for resize operations
  const draggingSkeleton = useRef(false);
  const skeletonDragStart = useRef(null);
  const skeletonOriginalPositions = useRef(null);
  const multiSkeletonOriginalPositions = useRef(null);
  const dragSelecting = useRef(false);
  const dragSelectStart = useRef(null);
  const dragSelectRect = useRef(null);
  const dragSelectCtrl = useRef(false);
  const mouseDownPos = useRef(null);
  const hasMoved = useRef(false);
  const DRAG_THRESHOLD = 5; // pixels - if mouse moves more than this, it's a drag
  const draggingMultipleKeypoints = useRef(false);
  const multiKeypointDragStart = useRef(null);
  const multiKeypointOriginalPositions = useRef(null);
  const draggingMultipleObjects = useRef(false);
  const mouseUpHandled = useRef(false);
  const justFinishedDragSelection = useRef(false);
  const justFinishedKeypointDrag = useRef(false);
  const justFinishedMultiDrag = useRef(false);
  const justFinishedSkeletonDrag = useRef(false);
  const justFinishedBboxDrag = useRef(false);
  const justFinishedBboxResize = useRef(false);
  const justClearedSelections = useRef(false);
  
  // Prevent double-click double-processing
  const lastDoubleClickTime = useRef(0);
  const lastDoubleClickKeypoint = useRef(null);
  const processingDoubleClick = useRef(false);
  
  // Track original selection state before bbox operations (for single animal mode)
  const originalBboxSelected = useRef(false);
  const forceDrawBboxSelection = useRef(null); // null | true | false - override for draw
  
  // Track original selection state for keypoints in multi-animal mode
  const originalKeypointSelections = useRef(new Map()); // objKey -> boolean (was originally selected)
  
  // Track original selection state for skeletons in multi-animal mode
  const originalSkeletonSelections = useRef(new Map()); // objKey -> boolean (was originally selected)
  
  // Track original selection state for bboxes in multi-animal mode  
  const originalBboxSelections = useRef(new Map()); // objKey -> boolean (was originally selected)
  
  // MULTI-ANIMAL MODE: Individual object tracking
  const hoveredObjectMA = useRef(null); // {type: 'keypoint'|'bbox'|'skeleton', objKey: string, ...details}
  const selectedObjectsMA = useRef(new Set()); // Set of objKeys for selected objects
  const draggingObjectMA = useRef(null); // {type, objKey, ...details}
  const textCanvasRef = useRef(null);
  const draggingSkeletonInfo = useRef(null); // {type:'completed'|'working'|'single', skeletonIndex, skeletonId}
  
  // Track how keypoints were selected: 'drag' = blue selected, 'click' = glow only
  const keypointSelectionType = useRef(new Map()); // objKey -> 'drag' | 'click'

  // MULTI-ANIMAL MODE: Enhanced multi-object selection and dragging
  const draggingMultiObjectsMA = useRef(false); // True when dragging multiple objects in MA mode
  const multiObjectDragStartMA = useRef(null); // Starting drag position
  const multiObjectOriginalPositionsMA = useRef(new Map()); // Original positions of all selected objects

  // Helper function to clear all selections and hover states
  const clearAllSelections = () => {
    let needsRedraw = false;
    if (selectedBbox) {
      setSelectedBbox(false);
      needsRedraw = true;
    }
    if (selectedKeypoints.current.size > 0) {
      selectedKeypoints.current.clear();
      needsRedraw = true;
    }
    if (selectedSkeleton) {
      setSelectedSkeleton(false);
      needsRedraw = true;
    }
    
    // Also clear hover states to ensure visual highlights are removed
    if (hoveredKeypoint.current !== null) {
      hoveredKeypoint.current = null;
      needsRedraw = true;
    }
    if (hoveredBbox.current) {
      hoveredBbox.current = false;
      needsRedraw = true;
    }
    if (hoveredSkeleton.current) {
      hoveredSkeleton.current = false;
      needsRedraw = true;
    }
    
    // Multi-animal per-object selections
    if (selectedObjectsMA.current.size > 0) {
      selectedObjectsMA.current.clear();
      needsRedraw = true;
    }
    
    // FIXED: Clear selectedImageObjects for sidebar highlighting
    setSelectedImageObjects && setSelectedImageObjects(new Set());
    
    // Clear keypoint selection type tracking
    keypointSelectionType.current.clear();
    
    // Clear multi-object dragging state
    draggingMultiObjectsMA.current = false;
    multiObjectDragStartMA.current = null;
    multiObjectOriginalPositionsMA.current.clear();
    
    // Sync selection state to sidebar
    syncSelectionToSidebar();
    
    // Clear keypoint selection tracking
    originalKeypointSelections.current.clear();
    
    // Clear skeleton selection tracking
    originalSkeletonSelections.current.clear();
    
    // Clear bbox selection tracking
    originalBboxSelections.current.clear();
    
    if (needsRedraw) {
      // Set flag to prevent hover updates from interfering
      justClearedSelections.current = true;
      // Immediately draw with cleared selections to ensure visual feedback
      draw({ 
        selectedBbox: false, 
        selectedSkeleton: false 
      });
      // Reset flag after a short delay
      setTimeout(() => {
        justClearedSelections.current = false;
      }, 50);
    }
  };

  // Clear only ref-based selections without triggering redraw (for undo/redo)
  const clearRefSelectionsOnly = () => {
    selectedKeypoints.current.clear();
    selectedObjectsMA.current.clear();
    keypointSelectionType.current.clear(); // Clear selection type tracking
    hoveredKeypoint.current = null;
    hoveredBbox.current = false;
    hoveredSkeleton.current = false;
    hoveredObjectMA.current = null;
    draggingMultiObjectsMA.current = false;
    multiObjectDragStartMA.current = null;
    multiObjectOriginalPositionsMA.current.clear();
    originalKeypointSelections.current.clear();
    originalSkeletonSelections.current.clear();
    originalBboxSelections.current.clear();
    syncSelectionToSidebar();
  };

  // Expose functions to parent component
  useImperativeHandle(ref, () => ({
    clearAllSelections,
    clearRefSelectionsOnly,
    draw
  }));

  // Trigger redraw when keypoint labels visibility changes
  useEffect(() => {
    draw();
  }, [showKeypointLabels]);

  const handleHideObjects = () => {
    let updated = false;
    
    setAnnotations(prev => {
      const next = [...prev];
      const ann = next[currentFrame] || {};
      let newAnn = { ...ann };
      
      if (multiAnimalMode) {
        // Multi-animal mode: hide selected objects (check both direct selections and sidebar selections)
        const hasDirectSelections = selectedObjectsMA.current.size > 0;
        const hasSidebarSelections = selectedImageObjects && selectedImageObjects.size > 0;
        
        if (hasDirectSelections || hasSidebarSelections) {
          // Hide completed skeletons
          if (newAnn.skeletons) {
            newAnn.skeletons = newAnn.skeletons.map((skeleton, index) => {
              const skeletonKey = `completed_skeleton_${index}`;
              if (selectedObjectsMA.current.has(skeletonKey) || 
                  (selectedImageObjects && selectedImageObjects.has(skeletonKey))) {
                updated = true;
                return { ...skeleton, hidden: !skeleton.hidden };
              }
              return skeleton;
            });
          }
          
          // Hide completed bboxes
          if (newAnn.bboxes) {
            newAnn.bboxes = newAnn.bboxes.map((bbox, index) => {
              const bboxKey = `completed_bbox_${index}`;
              if (selectedObjectsMA.current.has(bboxKey) || 
                  (selectedImageObjects && selectedImageObjects.has(bboxKey))) {
                updated = true;
                return { ...bbox, hidden: !bbox.hidden };
              }
              return bbox;
            });
          }
          
          // Hide working skeleton
          if (selectedObjectsMA.current.has('working_skeleton') || 
              (selectedImageObjects && selectedImageObjects.has('working_skeleton'))) {
            newAnn.skeletonHidden = !newAnn.skeletonHidden;
            updated = true;
          }
          
          // Hide working bbox
          if (selectedObjectsMA.current.has('working_bbox') || 
              (selectedImageObjects && selectedImageObjects.has('working_bbox'))) {
            newAnn.bboxHidden = !newAnn.bboxHidden;
            updated = true;
          }
        }
      } else {
        // Single animal mode: hide selected objects
        // Hide skeleton if selected or if any keypoints are selected
        if (selectedSkeleton || selectedKeypoints.current.size > 0) {
          newAnn.skeletonHidden = !newAnn.skeletonHidden;
          updated = true;
        }
        
        // Hide bbox if selected
        if (selectedBbox) {
          newAnn.bboxHidden = !newAnn.bboxHidden;
          updated = true;
        }
      }
      
      if (updated) {
        next[currentFrame] = newAnn;
      }
      
      return next;
    });
    
    if (updated) {
      // Save to undo stack after hiding
      setTimeout(() => saveToUndoStack && saveToUndoStack(), 0);
      // Clear selections after hiding
      clearAllSelections();
      draw();
    }
  };

  // MULTI-ANIMAL MODE: Helper functions for multi-object selection and movement
  const addToMultiAnimalSelection = (objKey) => {
    if (!multiAnimalMode) return;
    selectedObjectsMA.current.add(objKey);
    syncSelectionToSidebar();
  };

  const removeFromMultiAnimalSelection = (objKey) => {
    if (!multiAnimalMode) return;
    selectedObjectsMA.current.delete(objKey);
    syncSelectionToSidebar();
  };

  const isSelectedInMultiAnimal = (objKey) => {
    if (!multiAnimalMode) return false;
    
    // Check if the object itself is selected
    if (selectedObjectsMA.current.has(objKey)) {
      return true;
    }
    
    // CRITICAL FIX: If this is a keypoint, check if its parent skeleton is selected
    if (objKey.startsWith('completed_skeleton_') && objKey.split('_').length === 4) {
      // This is an individual keypoint: completed_skeleton_X_Y
      const parts = objKey.split('_');
      const skeletonKey = `completed_skeleton_${parts[2]}`;  // completed_skeleton_X
      return selectedObjectsMA.current.has(skeletonKey);
    }
    
    if (objKey.startsWith('working_skeleton_') && objKey !== 'working_skeleton') {
      // This is an individual working keypoint: working_skeleton_Y  
      return selectedObjectsMA.current.has('working_skeleton');
    }
    
    return false;
  };

  // Get all selected objects and their positions for multi-object dragging
  const getSelectedObjectPositions = () => {
    if (!multiAnimalMode) return new Map();
    
    const positions = new Map();
    const frameAnn = annotations[currentFrame] || {};
    
    selectedObjectsMA.current.forEach(objKey => {
      if (objKey.startsWith('completed_skeleton_')) {
        const parts = objKey.split('_');
        if (parts.length === 3) {
          // Whole skeleton: completed_skeleton_X
          const skeletonIndex = parseInt(parts[2]);
          const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
          if (skeleton && skeleton.keypoints) {
            skeleton.keypoints.forEach((pt, idx) => {
              if (pt) {
                positions.set(`${objKey}_${idx}`, { ...pt });
              }
            });
          }
        } else if (parts.length === 4) {
          // Individual keypoint: completed_skeleton_X_Y
          const skeletonIndex = parseInt(parts[2]);
          const keypointIndex = parseInt(parts[3]);
          const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
          if (skeleton && skeleton.keypoints && skeleton.keypoints[keypointIndex]) {
            positions.set(objKey, { ...skeleton.keypoints[keypointIndex] });
          }
        }
      } else if (objKey === 'working_skeleton') {
        // Whole working skeleton
        if (frameAnn.keypoints) {
          frameAnn.keypoints.forEach((pt, idx) => {
            if (pt) {
              positions.set(`working_skeleton_${idx}`, { ...pt });
            }
          });
        }
      } else if (objKey.startsWith('working_skeleton_')) {
        // Individual working keypoint
        const keypointIndex = parseInt(objKey.split('_')[2]);
        if (frameAnn.keypoints && frameAnn.keypoints[keypointIndex]) {
          positions.set(objKey, { ...frameAnn.keypoints[keypointIndex] });
        }
      } else if (objKey.startsWith('completed_bbox_')) {
        // Completed bbox
        const bboxIndex = parseInt(objKey.split('_')[2]);
        const bbox = (frameAnn.bboxes || [])[bboxIndex];
        if (bbox && bbox.bbox) {
          positions.set(objKey, { 
            x: bbox.bbox[0], 
            y: bbox.bbox[1], 
            w: bbox.bbox[2], 
            h: bbox.bbox[3] 
          });
        }
      } else if (objKey === 'working_bbox') {
        // Working bbox
        if (frameAnn.bbox) {
          positions.set(objKey, { 
            x: frameAnn.bbox[0], 
            y: frameAnn.bbox[1], 
            w: frameAnn.bbox[2], 
            h: frameAnn.bbox[3] 
          });
        }
      }
    });
    
    return positions;
  };

  // Get image dimensions
  const getImageDims = () => {
    if (!imageRef.current) return { width: 640, height: 480 };
    return { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight };
  };

  // Map canvas pixel coordinates to image coordinates (like mapToScene in Qt)
  const mapToImageCoords = (canvasX, canvasY) => {
    const { width: imgW, height: imgH } = getImageDims();
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };

    // Calculate where the image is displayed within the canvas
    const canvasW = container.clientWidth;
    const canvasH = container.clientHeight;
    
    // Apply zoom and pan transform (like Qt's transform)
    const scaledImgW = imgW * scale.current;
    const scaledImgH = imgH * scale.current;
    
    // Center the image in the canvas, then apply pan offset
    const imgX = (canvasW - scaledImgW) / 2 + offset.current.x;
    const imgY = (canvasH - scaledImgH) / 2 + offset.current.y;
    
    // Convert canvas coordinates to image coordinates
    const relX = (canvasX - imgX) / scale.current;
    const relY = (canvasY - imgY) / scale.current;
    
    return { x: relX, y: relY };
  };

  // Map image coordinates to canvas pixel coordinates
  const mapToCanvasCoords = (imgX, imgY) => {
    const { width: imgW, height: imgH } = getImageDims();
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };

    const canvasW = container.clientWidth;
    const canvasH = container.clientHeight;
    
    const scaledImgW = imgW * scale.current;
    const scaledImgH = imgH * scale.current;
    
    const displayX = (canvasW - scaledImgW) / 2 + offset.current.x;
    const displayY = (canvasH - scaledImgH) / 2 + offset.current.y;
    
    const canvasX = displayX + imgX * scale.current;
    const canvasY = displayY + imgY * scale.current;
    
    return { x: canvasX, y: canvasY };
  };

  // Draw text labels on overlay canvas
  const drawTextLabels = (overrideSelections = {}) => {
    const textCanvas = textCanvasRef.current;
    const textCtx = textCanvas.getContext('2d');
    const container = containerRef.current;
    
    if (!textCanvas || !textCtx || !container) return;

    // Set canvas size to container
    textCanvas.width = container.clientWidth;
    textCanvas.height = container.clientHeight;
    
    // Clear canvas
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    
    // If labels are hidden, just clear and return
    if (!showKeypointLabels) return;
    
    // Get objects to render (same logic as draw function)
    const frameAnn = annotations[currentFrame] || {};
    let objectsToRender = [];
    
    if (multiAnimalMode) {
      // Multi-animal mode: render all objects in the frame
      const skeletons = frameAnn.skeletons || [];
      
      // Add skeleton objects (include index so objKeys match selection logic)
      skeletons.forEach((skeleton, skeletonIndex) => {
        // Skip hidden skeletons in multi-animal mode
        if (skeleton.hidden) return;
        
        objectsToRender.push({
          type: 'skeleton',
          keypoints: skeleton.keypoints,
          visibilities: skeleton.visibilities,
          id: skeleton.id,
          skeletonId: skeleton.id,
          skeletonIndex,
        });
      });
      
      // If we're currently creating a new object, add it
      if (frameAnn.keypoints && !frameAnn.skeletonHidden) {
        objectsToRender.push({
          type: 'skeleton',
          keypoints: frameAnn.keypoints,
          visibilities: frameAnn.visibilities,
          id: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId,
          skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId
        });
      }
    } else {
      // Single animal mode: use legacy structure
      if (frameAnn.keypoints) {
        const obj = {
          type: 'combined',
          keypoints: frameAnn.keypoints,
          visibilities: frameAnn.visibilities,
          skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0,
          skeletonHidden: frameAnn.skeletonHidden || false
        };
        objectsToRender.push(obj);
      }
    }
    
    // Draw keypoint labels for all objects
    objectsToRender.forEach(obj => {
      if (!obj.keypoints || !Array.isArray(obj.keypoints)) return;
      
      // Skip hidden skeletons in single animal mode
      if (!multiAnimalMode && obj.skeletonHidden) return;
      
      obj.keypoints.forEach((pt, idx) => {
        if (!pt) return;
        
        const vis = obj.visibilities ? obj.visibilities[idx] : 2;
        const { x: canvasX, y: canvasY } = mapToCanvasCoords(pt.x, pt.y);
        
        // Build objKey and interaction flags so label colors behave like single-animal mode
        let objKey;
        let isHovered = false;
        let isDragging = false;
        let isSelected = false;
        
        if (multiAnimalMode) {
          if (obj.type === 'skeleton' && obj.skeletonIndex !== undefined) {
            objKey = `completed_skeleton_${obj.skeletonIndex}_${idx}`;
          } else {
            // Working skeleton under construction
            objKey = `working_skeleton_${idx}`;
          }

          isHovered = hoveredObjectMA.current &&
                     hoveredObjectMA.current.type === 'keypoint' &&
                     hoveredObjectMA.current.objKey === objKey;

          isDragging = draggingObjectMA.current &&
                       draggingObjectMA.current.type === 'keypoint' &&
                       draggingObjectMA.current.objKey === objKey;

          // Check override selection states first, then actual states
          const actualSelectedSkeleton = overrideSelections.selectedSkeleton !== undefined ? overrideSelections.selectedSkeleton : false;
          const actualSelectedBbox = overrideSelections.selectedBbox !== undefined ? overrideSelections.selectedBbox : false;
          
          // In multi-animal mode, respect overrides (when clearing selections)
          if (overrideSelections.selectedSkeleton === false) {
            isSelected = false; // Force no selection when overriding
          } else {
            isSelected = selectedObjectsMA.current.has(objKey) || selectedKeypoints.current.has(objKey);
          }
        } else {
          objKey = `${obj.skeletonId}_${idx}`;
          isHovered = hoveredKeypoint.current && hoveredKeypoint.current.objKey === objKey;
          isDragging = dragActive.current && selectedKeypoint.current && selectedKeypoint.current.objKey === objKey;
          // FIXED: In single-animal mode, check override selection states first, then actual states
          const actualSelectedSkeleton = overrideSelections.selectedSkeleton !== undefined ? overrideSelections.selectedSkeleton : selectedSkeleton;
          isSelected = selectedKeypoints.current.has(objKey) || actualSelectedSkeleton;
        }
        
        textCtx.font = '12px Arial';
        const labelColor = isSelected ? KEYPOINT_SELECTED_COLOR : 
                          (isHovered || isDragging) ? '#ff6600' : '#cc4400';
        textCtx.fillStyle = labelColor;
        textCtx.fillText(keypointLabels[idx], canvasX + 10, canvasY - 10);
      });
    });
  };

  // Draw everything
  const draw = (overrideSelections = {}) => {
    // Use override values if provided, otherwise use current state
    let currentSelectedBbox = overrideSelections.selectedBbox !== undefined ? overrideSelections.selectedBbox : selectedBbox;
    
    // Check for forced bbox selection override (for single animal mode operations)
    if (!multiAnimalMode && forceDrawBboxSelection.current !== null) {
      currentSelectedBbox = forceDrawBboxSelection.current;
    }
    
    const currentSelectedSkeleton = overrideSelections.selectedSkeleton !== undefined ? overrideSelections.selectedSkeleton : selectedSkeleton;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = containerRef.current;
    
    if (!canvas || !ctx || !container) return;

    // Set canvas size to container
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw drag selection rectangle if active
    if (dragSelecting.current && dragSelectRect.current) {
      const { x, y, w, h } = dragSelectRect.current;
      ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    
    // Draw image if loaded
    if (imageRef.current) {
      const { width: imgW, height: imgH } = getImageDims();
      const { x: displayX, y: displayY } = mapToCanvasCoords(0, 0);
      
      ctx.drawImage(
        imageRef.current,
        displayX,
        displayY,
        imgW * scale.current,
        imgH * scale.current
      );
    }

    // Get annotations based on mode
    const frameAnn = annotations[currentFrame] || {};
    let objectsToRender = [];
    
    if (multiAnimalMode) {
      // Multi-animal mode: render all objects in the frame
      const skeletons = frameAnn.skeletons || [];
      const bboxes = frameAnn.bboxes || [];
      
      // Add skeleton objects (include index so objKeys match selection logic)
      skeletons.forEach((skeleton, skeletonIndex) => {
        // Skip hidden skeletons in multi-animal mode
        if (skeleton.hidden) return;
        
        objectsToRender.push({
          type: 'skeleton',
          keypoints: skeleton.keypoints,
          visibilities: skeleton.visibilities,
          id: skeleton.id,
          skeletonId: skeleton.id,
          skeletonIndex,
        });
      });
      
      // Add bbox objects
      bboxes.forEach((bbox, bboxIndex) => {
        // Skip hidden bboxes in multi-animal mode
        if (bbox.hidden) return;
        objectsToRender.push({
          type: 'bbox',
          bbox: bbox.bbox,
          id: bbox.id,
          bboxId: bbox.id,
          bboxIndex
        });
      });
      
      // If we're currently creating a new object, add it
      // BUT first check if this working skeleton has same ID as any completed skeleton (avoid duplicates)
      if (frameAnn.keypoints || frameAnn.bbox) {
        if (frameAnn.keypoints && frameAnn.keypoints.some(pt => pt !== null) && !frameAnn.skeletonHidden) {
          const workingSkeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId;
          
          // Check if a completed skeleton already exists with this ID
          const completedSkeletonExists = skeletons.some(skeleton => skeleton.id === workingSkeletonId);
          
          // Only render working skeleton if no completed skeleton exists with same ID
          // AND if it actually has some keypoints placed AND is not hidden
          if (!completedSkeletonExists) {
            objectsToRender.push({
              type: 'skeleton',
              keypoints: frameAnn.keypoints,
              visibilities: frameAnn.visibilities,
              id: workingSkeletonId,
              skeletonId: workingSkeletonId
            });
          }
        }
        if (frameAnn.bbox && !frameAnn.bboxHidden) {
          const workingBboxId = frameAnn.bboxId !== undefined ? frameAnn.bboxId : currentBboxId;
          
          // Check if a completed bbox already exists with this ID
          const completedBboxExists = bboxes.some(bbox => bbox.id === workingBboxId);
          
          // Only render working bbox if no completed bbox exists with same ID AND is not hidden
          if (!completedBboxExists) {
            objectsToRender.push({
              type: 'bbox',
              bbox: frameAnn.bbox,
              id: workingBboxId,
              bboxId: workingBboxId
            });
          }
        }
      }
    } else {
      // Single animal mode: use legacy structure
      if (frameAnn.keypoints || frameAnn.bbox) {
        const obj = {
          type: 'combined',
          keypoints: frameAnn.keypoints,
          visibilities: frameAnn.visibilities,
          bbox: frameAnn.bbox,
          skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0,
          bboxId: frameAnn.bboxId !== undefined ? frameAnn.bboxId : 0,
          // Add hidden flags for single animal mode
          skeletonHidden: frameAnn.skeletonHidden || false,
          bboxHidden: frameAnn.bboxHidden || false
        };
        objectsToRender.push(obj);
      }
    }
    
    // Draw bounding boxes - SEPARATED logic for single vs multi-animal modes
    objectsToRender.forEach((obj, objIndex) => {
      if (!obj.bbox) return;
      
      // Skip hidden bboxes in single animal mode
      if (!multiAnimalMode && obj.bboxHidden) return;
      
      const [x, y, w, h] = obj.bbox;
      const { x: canvasX, y: canvasY } = mapToCanvasCoords(x, y);
      
      let isHovered = false;
      let isSelected = false;
      let isSidebarHovered = false;
      
      if (multiAnimalMode) {
        // MULTI-ANIMAL MODE: Individual object tracking
        const objKey = obj.type === 'bbox' ? `completed_bbox_${obj.bboxIndex}` : 'working_bbox';
        
        isHovered = hoveredObjectMA.current && 
                   hoveredObjectMA.current.type === 'bbox' && 
                   hoveredObjectMA.current.objKey === objKey;
        
        isSelected = selectedObjectsMA.current.has(objKey) || (selectedImageObjects && selectedImageObjects.has(objKey));
        
        isSidebarHovered = hoveredSidebarObject && 
                          hoveredSidebarObject.type === 'bbox' && 
                          hoveredSidebarObject.objKey === objKey;
      } else {
        // SINGLE ANIMAL MODE: Updated logic to use objKey matching like multi-animal mode
        isHovered = hoveredBbox.current;
        isSelected = currentSelectedBbox;
        isSidebarHovered = hoveredSidebarObject && 
                          hoveredSidebarObject.type === 'bbox' && 
                          hoveredSidebarObject.objKey === 'working_bbox';
      }
      
      ctx.save();
      
      // Draw selection highlight (only when selected, not on hover)
      if (isSelected) {
        ctx.fillStyle = 'rgba(0, 123, 255, 0.1)'; // Blue selection fill
        ctx.fillRect(canvasX, canvasY, w * scale.current, h * scale.current);
      }
      
      // Draw hover highlight (separate from selection)
      if ((isHovered && !isSelected) || isSidebarHovered) {
        ctx.fillStyle = 'rgba(255, 165, 0, 0.1)'; // Orange hover fill
        ctx.fillRect(canvasX, canvasY, w * scale.current, h * scale.current);
      }
      
      // Draw bbox outline
      if (isSelected) {
        ctx.strokeStyle = '#007bff'; // Blue for selected
        ctx.lineWidth = 3;
      } else if (isHovered || isSidebarHovered) {
        ctx.strokeStyle = '#ff6600'; // Orange for hover
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = 'red'; // Default red
        ctx.lineWidth = 2;
      }
      ctx.strokeRect(canvasX, canvasY, w * scale.current, h * scale.current);
      
      // Draw resize handles when hovered, selected, or THIS SPECIFIC bbox is being resized
      let isThisBboxBeingResized = false;
      if (resizingBbox.current && resizeBboxInfo.current) {
        if (multiAnimalMode) {
          // In multi-animal mode, check if this specific bbox is the one being resized
          const objKey = obj.type === 'bbox' ? `completed_bbox_${obj.bboxIndex}` : 'working_bbox';
          isThisBboxBeingResized = resizeBboxInfo.current.objKey === objKey;
        } else {
          // In single animal mode, there's only one bbox so any resize applies to it
          isThisBboxBeingResized = true;
        }
      }
      
      if (isHovered || isSelected || isThisBboxBeingResized) {
        const handleSize = 6;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        
        // Corner handles
        const handles = [
          { x: canvasX - handleSize/2, y: canvasY - handleSize/2 }, // nw
          { x: canvasX + w * scale.current - handleSize/2, y: canvasY - handleSize/2 }, // ne
          { x: canvasX - handleSize/2, y: canvasY + h * scale.current - handleSize/2 }, // sw
          { x: canvasX + w * scale.current - handleSize/2, y: canvasY + h * scale.current - handleSize/2 }, // se
          { x: canvasX + (w * scale.current / 2) - handleSize/2, y: canvasY - handleSize/2 }, // n
          { x: canvasX + (w * scale.current / 2) - handleSize/2, y: canvasY + h * scale.current - handleSize/2 }, // s
          { x: canvasX - handleSize/2, y: canvasY + (h * scale.current / 2) - handleSize/2 }, // w
          { x: canvasX + w * scale.current - handleSize/2, y: canvasY + (h * scale.current / 2) - handleSize/2 }, // e
        ];
        
        handles.forEach(handle => {
          ctx.fillRect(handle.x, handle.y, handleSize, handleSize);
          ctx.strokeRect(handle.x, handle.y, handleSize, handleSize);
        });
      }
      
      ctx.restore();
    });

    // Draw skeleton connections - SEPARATED logic for single vs multi-animal modes
    objectsToRender.forEach((obj, objIndex) => {
      if (!obj.keypoints || !Array.isArray(obj.keypoints)) return;
      
      // Skip hidden skeletons in single animal mode
      if (!multiAnimalMode && obj.skeletonHidden) return;
      
      let isSkeletonInteractive = false;
      
      if (multiAnimalMode) {
        // MULTI-ANIMAL MODE: Individual object tracking
        const objKey = obj.type === 'skeleton' && obj.skeletonIndex !== undefined ? `completed_skeleton_${obj.skeletonIndex}` : 'working_skeleton';
        
        const isHovered = hoveredObjectMA.current && 
                         hoveredObjectMA.current.type === 'skeleton' && 
                         hoveredObjectMA.current.objKey === objKey;
        
        const isSelected = selectedObjectsMA.current.has(objKey) || (selectedImageObjects && selectedImageObjects.has(objKey));
        
        const isDragging = draggingObjectMA.current && 
                          draggingObjectMA.current.type === 'skeleton' && 
                          draggingObjectMA.current.objKey === objKey;
        
        const isSidebarHovered = hoveredSidebarObject && 
                                hoveredSidebarObject.type === 'skeleton' && 
                                hoveredSidebarObject.objKey === objKey;
        
        isSkeletonInteractive = isHovered || isDragging || isSelected || isSidebarHovered;
      } else {
        // SINGLE ANIMAL MODE: Updated logic to use objKey matching like multi-animal mode
        const isSidebarHovered = hoveredSidebarObject && 
                                hoveredSidebarObject.type === 'skeleton' && 
                                hoveredSidebarObject.objKey === 'working_skeleton';
        
        isSkeletonInteractive = hoveredSkeleton.current || draggingSkeleton.current || currentSelectedSkeleton || isSidebarHovered;
      }
      
      ctx.save();
      
      // Set skeleton appearance based on interaction state
      ctx.strokeStyle = isSkeletonInteractive ? SKELETON_HOVER_COLOR : SKELETON_NORMAL_COLOR;
      ctx.lineWidth = isSkeletonInteractive ? 5 : 3;
      ctx.lineCap = 'round';
      
      skeletonConnections.forEach(([idx1, idx2]) => {
        const pt1 = obj.keypoints[idx1];
        const pt2 = obj.keypoints[idx2];
        
        // Only draw connection if both keypoints exist and are visible
        if (pt1 && pt2) {
          const vis1 = obj.visibilities ? obj.visibilities[idx1] : 2;
          const vis2 = obj.visibilities ? obj.visibilities[idx2] : 2;
          
          // Draw line if both keypoints are visible (not "not labeled")
          if (vis1 !== 0 && vis2 !== 0) {
            const { x: canvasX1, y: canvasY1 } = mapToCanvasCoords(pt1.x, pt1.y);
            const { x: canvasX2, y: canvasY2 } = mapToCanvasCoords(pt2.x, pt2.y);
            
            ctx.beginPath();
            ctx.moveTo(canvasX1, canvasY1);
            ctx.lineTo(canvasX2, canvasY2);
            ctx.stroke();
          }
        }
      });
      
      ctx.restore();
    });

    // Draw keypoints - SEPARATED logic for single vs multi-animal modes
    objectsToRender.forEach((obj, objIndex) => {
      if (!obj.keypoints || !Array.isArray(obj.keypoints)) return;
      
      // Skip hidden skeletons in single animal mode
      if (!multiAnimalMode && obj.skeletonHidden) return;
      
      obj.keypoints.forEach((pt, idx) => {
        if (!pt) return;
        
        const vis = obj.visibilities ? obj.visibilities[idx] : 2;
        const { x: canvasX, y: canvasY } = mapToCanvasCoords(pt.x, pt.y);
        
        let isHovered = false;
        let isDragging = false;
        let isSelected = false;
        let isSkeletonHighlighted = false;
        
        // Check sidebar hover for all modes (needed before use below)
        const isSkeletonSidebarHovered = hoveredSidebarObject && 
                                        hoveredSidebarObject.type === 'skeleton' && 
                                        (multiAnimalMode ? 
                                          (hoveredSidebarObject.objKey === (obj.type === 'skeleton' && obj.skeletonIndex !== undefined 
                                            ? `completed_skeleton_${obj.skeletonIndex}` 
                                            : 'working_skeleton')) :
                                          hoveredSidebarObject.objKey === 'working_skeleton');
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Individual object tracking
          const objKey = obj.type === 'skeleton' && obj.skeletonIndex !== undefined
            ? `completed_skeleton_${obj.skeletonIndex}_${idx}`
            : `working_skeleton_${idx}`;
          const skeletonObjKey = obj.type === 'skeleton' && obj.skeletonIndex !== undefined
            ? `completed_skeleton_${obj.skeletonIndex}`
            : 'working_skeleton';
          
          isHovered = hoveredObjectMA.current && 
                     hoveredObjectMA.current.type === 'keypoint' && 
                     hoveredObjectMA.current.objKey === objKey;
          
          isDragging = draggingObjectMA.current && 
                      draggingObjectMA.current.type === 'keypoint' && 
                      draggingObjectMA.current.objKey === objKey;
          
          // FIXED: Check individual keypoint selection AND selection type
          // Blue selection only for: 1) individually selected keypoints, 2) drag-selected skeleton keypoints
          const isIndividuallySelected = selectedObjectsMA.current.has(objKey) || (selectedImageObjects && selectedImageObjects.has(objKey));
          const isInKeypointSet = selectedKeypoints.current.has(objKey);
          const selectionType = keypointSelectionType.current.get(objKey);
          
          // Blue selection for: direct keypoint selection OR drag-selected skeleton keypoints
          isSelected = isIndividuallySelected || (isInKeypointSet && selectionType === 'drag');
          
          // Check if skeleton is highlighted
          const skeletonHovered = hoveredObjectMA.current && 
                                 hoveredObjectMA.current.type === 'skeleton' && 
                                 hoveredObjectMA.current.objKey === skeletonObjKey;
          
          const skeletonDragging = draggingObjectMA.current && 
                                  draggingObjectMA.current.type === 'skeleton' && 
                                  draggingObjectMA.current.objKey === skeletonObjKey;
          
          const skeletonSelected = selectedObjectsMA.current.has(skeletonObjKey) || (selectedImageObjects && selectedImageObjects.has(skeletonObjKey));
          
          isSkeletonHighlighted = skeletonHovered || skeletonDragging || skeletonSelected || isSkeletonSidebarHovered;
        } else {
          // SINGLE ANIMAL MODE: Original logic
          const objKey = `${obj.skeletonId}_${idx}`;
          
          isHovered = hoveredKeypoint.current && hoveredKeypoint.current.objKey === objKey;
          isDragging = dragActive.current && selectedKeypoint.current && selectedKeypoint.current.objKey === objKey;
          isSelected = selectedKeypoints.current.has(objKey);
          
          isSkeletonHighlighted = hoveredSkeleton.current || draggingSkeleton.current || isSkeletonSidebarHovered;
        }
        

        
        ctx.save();
        
        // Draw selection highlight
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(canvasX, canvasY, KEYPOINT_RADIUS + 6, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(0, 123, 255, 0.3)'; // Blue selection glow
          ctx.fill();
        }
        
        // Draw hover highlight
        if (isHovered && !isDragging) {
          ctx.beginPath();
          ctx.arc(canvasX, canvasY, KEYPOINT_RADIUS + 4, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255, 165, 0, 0.3)'; // Orange glow
          ctx.fill();
        }
        

        
        // Draw skeleton highlight (affects all keypoints)
        const shouldShowSkeletonGlow = multiAnimalMode ? 
          (isSkeletonHighlighted && areAllKeypointsPlaced(obj)) :
          ((isSkeletonHighlighted || currentSelectedSkeleton || isSkeletonSidebarHovered) && areAllKeypointsPlaced());
          
        if (shouldShowSkeletonGlow) {
          ctx.beginPath();
          ctx.arc(canvasX, canvasY, KEYPOINT_RADIUS + 4, 0, 2 * Math.PI);
          // In multi-animal mode, use skeleton selection state; in single-animal mode, use currentSelectedSkeleton
          const useBlueGlow = multiAnimalMode ? 
            (selectedObjectsMA.current.has(obj.type === 'skeleton' && obj.skeletonIndex !== undefined ? `completed_skeleton_${obj.skeletonIndex}` : 'working_skeleton') || 
             (selectedImageObjects && selectedImageObjects.has(obj.type === 'skeleton' && obj.skeletonIndex !== undefined ? `completed_skeleton_${obj.skeletonIndex}` : 'working_skeleton'))) :
            currentSelectedSkeleton;
          ctx.fillStyle = useBlueGlow ? 'rgba(0, 123, 255, 0.2)' : 'rgba(255, 165, 0, 0.2)'; // Blue for selected, orange for hover
          ctx.fill();
        }
        
        // Note: Removed green dragging highlight - blue selection highlight is sufficient
        
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, KEYPOINT_RADIUS, 0, 2 * Math.PI);
        
        if (vis === 2) {
          // Visible keypoint
          ctx.fillStyle = isSelected ? KEYPOINT_SELECTED_COLOR : KEYPOINT_COLOR;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = isSelected ? '#0056b3' : KEYPOINT_COLOR;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();
        } else if (vis === 1) {
          // Hidden but labeled keypoint
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = isSelected ? KEYPOINT_SELECTED_COLOR : KEYPOINT_COLOR;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();
        } else if (vis === 0) {
          // Not labeled keypoint (X mark)
          ctx.strokeStyle = isSelected ? KEYPOINT_SELECTED_COLOR : KEYPOINT_COLOR;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.beginPath();
          ctx.moveTo(canvasX - KEYPOINT_RADIUS, canvasY - KEYPOINT_RADIUS);
          ctx.lineTo(canvasX + KEYPOINT_RADIUS, canvasY + KEYPOINT_RADIUS);
          ctx.moveTo(canvasX + KEYPOINT_RADIUS, canvasY - KEYPOINT_RADIUS);
          ctx.lineTo(canvasX - KEYPOINT_RADIUS, canvasY + KEYPOINT_RADIUS);
          ctx.stroke();
        }
        
        ctx.restore();
      });
    });

    // Draw current box being drawn
    if (currentBox.current) {
      const { x, y, w, h } = currentBox.current;
      const { x: canvasX, y: canvasY } = mapToCanvasCoords(x, y);
      
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.strokeRect(canvasX, canvasY, w * scale.current, h * scale.current);
    }

    // Draw drag selection rectangle
    if (dragSelectRect.current) {
      const { x, y, w, h } = dragSelectRect.current;
      
      ctx.save();
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.fillStyle = 'rgba(0, 123, 255, 0.1)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    
    // Draw text labels on overlay canvas
    drawTextLabels(overrideSelections);
  };

  // Find keypoint near position - SEPARATE logic for single vs multi-animal modes
  const findKeypoint = (imgX, imgY) => {
    const frameAnn = annotations[currentFrame] || {};
    const threshold = KEYPOINT_RADIUS / scale.current;
    
    if (multiAnimalMode) {
      // MULTI-ANIMAL MODE: Each object is completely separate
      let closestResult = null;
    let closestDistance = Infinity;
      
      // Check completed skeletons (each has unique object key)
      const skeletons = frameAnn.skeletons || [];
      skeletons.forEach((skeleton, skeletonIndex) => {
        if (!skeleton.keypoints || skeleton.hidden) return;
        
        skeleton.keypoints.forEach((pt, idx) => {
          if (!pt) return;
          
          const vis = skeleton.visibilities ? skeleton.visibilities[idx] : 2;
          // Allow interaction with all keypoints regardless of visibility
      
      const dx = pt.x - imgX;
      const dy = pt.y - imgY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < threshold && distance < closestDistance) {
        closestDistance = distance;
            closestResult = {
              idx: idx,
              skeletonId: skeleton.id,
              objKey: `completed_skeleton_${skeletonIndex}_${idx}`, // Unique object key
              objectType: 'completed_skeleton',
              objectIndex: skeletonIndex,
              keypoint: pt,
              visibility: vis
            };
          }
        });
      });
      
      // Check current working skeleton
      if (frameAnn.keypoints && !frameAnn.skeletonHidden) {
        frameAnn.keypoints.forEach((pt, idx) => {
          if (!pt) return;
          
          const vis = frameAnn.visibilities ? frameAnn.visibilities[idx] : 2;
          // Allow interaction with all keypoints regardless of visibility
          
          const dx = pt.x - imgX;
          const dy = pt.y - imgY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < threshold && distance < closestDistance) {
            closestDistance = distance;
            const workingSkeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId;
            closestResult = {
              idx: idx,
              skeletonId: workingSkeletonId,
              objKey: `working_skeleton_${idx}`, // Unique object key
              objectType: 'working_skeleton',
              objectIndex: null,
              keypoint: pt,
              visibility: vis
            };
          }
        });
      }
      
      return closestResult;
      
    } else {
      // SINGLE ANIMAL MODE: Original logic unchanged
      if (!frameAnn.keypoints || frameAnn.skeletonHidden) return null;
      
      let closestResult = null;
      let closestDistance = Infinity;
      
      frameAnn.keypoints.forEach((pt, idx) => {
        if (!pt) return;
        
        const vis = frameAnn.visibilities ? frameAnn.visibilities[idx] : 2;
        // Allow interaction with all keypoints regardless of visibility
        
        const dx = pt.x - imgX;
        const dy = pt.y - imgY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < threshold && distance < closestDistance) {
          closestDistance = distance;
          closestResult = {
            idx: idx,
            skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0,
            objKey: `${frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0}_${idx}`,
            keypoint: pt,
            visibility: vis
          };
        }
      });
      
      return closestResult;
    }
  };

  // Find keypoint for double-click (includes all visibility states) - SEPARATE logic for single vs multi-animal modes
  const findKeypointForDoubleClick = (imgX, imgY) => {
    const frameAnn = annotations[currentFrame] || {};
    const threshold = KEYPOINT_RADIUS / scale.current;
    
    if (multiAnimalMode) {
      // MULTI-ANIMAL MODE: Each object is completely separate
      let closestResult = null;
    let closestDistance = Infinity;
      
      // Check completed skeletons (each has unique object key)
      const skeletons = frameAnn.skeletons || [];
      skeletons.forEach((skeleton, skeletonIndex) => {
        if (!skeleton.keypoints || skeleton.hidden) return;
        
        skeleton.keypoints.forEach((pt, idx) => {
          if (!pt) return;
          
      const dx = pt.x - imgX;
      const dy = pt.y - imgY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < threshold && distance < closestDistance) {
        closestDistance = distance;
            closestResult = {
              idx: idx,
              skeletonId: skeleton.id,
              objKey: `completed_skeleton_${skeletonIndex}_${idx}`, // Unique object key
              objectType: 'completed_skeleton',
              objectIndex: skeletonIndex,
              keypoint: pt,
              visibility: skeleton.visibilities ? skeleton.visibilities[idx] : 2
            };
          }
        });
      });
      
      // Check current working skeleton
      if (frameAnn.keypoints && !frameAnn.skeletonHidden) {
        frameAnn.keypoints.forEach((pt, idx) => {
          if (!pt) return;
          
          const dx = pt.x - imgX;
          const dy = pt.y - imgY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < threshold && distance < closestDistance) {
            closestDistance = distance;
            const workingSkeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId;
            closestResult = {
              idx: idx,
              skeletonId: workingSkeletonId,
              objKey: `working_skeleton_${idx}`, // Unique object key
              objectType: 'working_skeleton',
              objectIndex: null,
              keypoint: pt,
              visibility: frameAnn.visibilities ? frameAnn.visibilities[idx] : 2
            };
          }
        });
      }
      
      return closestResult;
      
    } else {
      // SINGLE ANIMAL MODE: Original logic unchanged
      if (!frameAnn.keypoints || frameAnn.skeletonHidden) return null;
      
      let closestResult = null;
      let closestDistance = Infinity;
      
      frameAnn.keypoints.forEach((pt, idx) => {
        if (!pt) return;
        
        const dx = pt.x - imgX;
        const dy = pt.y - imgY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < threshold && distance < closestDistance) {
          closestDistance = distance;
          closestResult = {
            idx: idx,
            skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0,
            objKey: `${frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0}_${idx}`,
            keypoint: pt,
            visibility: frameAnn.visibilities ? frameAnn.visibilities[idx] : 2
          };
        }
      });
      
      return closestResult;
    }
  };

  // Find if point is inside bounding box - SEPARATE logic for single vs multi-animal modes
  const findBbox = (imgX, imgY) => {
    const frameAnn = annotations[currentFrame] || {};
    
    if (multiAnimalMode) {
      // MULTI-ANIMAL MODE: Each bbox is completely separate
      const bboxes = frameAnn.bboxes || [];
      
      // Check completed bboxes (each has unique object key) - start from end for topmost
      for (let bboxIndex = bboxes.length - 1; bboxIndex >= 0; bboxIndex--) {
        const bboxObj = bboxes[bboxIndex];
        if (!bboxObj.bbox || bboxObj.hidden) continue;
        
        const [x, y, w, h] = bboxObj.bbox;
        if (imgX >= x && imgX <= x + w && imgY >= y && imgY <= y + h) {
                  return {
          bboxId: bboxObj.id,
          bbox: bboxObj.bbox,
          objKey: `completed_bbox_${bboxIndex}`, // Use array index like skeletons do
          objectType: 'completed_bbox',
          objectIndex: bboxIndex
        };
        }
      }
      
      // Check current working bbox
      if (frameAnn.bbox && !frameAnn.bboxHidden) {
        const [x, y, w, h] = frameAnn.bbox;
        if (imgX >= x && imgX <= x + w && imgY >= y && imgY <= y + h) {
          const bboxId = frameAnn.bboxId !== undefined ? frameAnn.bboxId : currentBboxId;
          return {
            bboxId: bboxId,
            bbox: frameAnn.bbox,
            objKey: 'working_bbox', // Working bbox has consistent key
            objectType: 'working_bbox',
            objectIndex: null
          };
        }
      }
      
      return null;
      
    } else {
      // SINGLE ANIMAL MODE: Original logic unchanged
      if (!frameAnn.bbox || frameAnn.bboxHidden) return null;
      
      const [x, y, w, h] = frameAnn.bbox;
      if (imgX >= x && imgX <= x + w && imgY >= y && imgY <= y + h) {
        const bboxId = frameAnn.bboxId !== undefined ? frameAnn.bboxId : 0;
        return {
          bboxId: bboxId,
          bbox: frameAnn.bbox
        };
      }
      
      return null;
    }
  };

  // Find resize handle for bounding box - works with both modes
  const findBboxResizeHandle = (imgX, imgY) => {
    const bboxResult = findBbox(imgX, imgY);
    if (!bboxResult) return null;
    
    const [x, y, w, h] = bboxResult.bbox;
    const handleSize = 8 / scale.current; // Scale-aware handle size in image coordinates
    
    // Check corners first (priority)
    if (imgX >= x - handleSize && imgX <= x + handleSize && 
        imgY >= y - handleSize && imgY <= y + handleSize) return { handle: 'nw', ...bboxResult };
    if (imgX >= x + w - handleSize && imgX <= x + w + handleSize && 
        imgY >= y - handleSize && imgY <= y + handleSize) return { handle: 'ne', ...bboxResult };
    if (imgX >= x - handleSize && imgX <= x + handleSize && 
        imgY >= y + h - handleSize && imgY <= y + h + handleSize) return { handle: 'sw', ...bboxResult };
    if (imgX >= x + w - handleSize && imgX <= x + w + handleSize && 
        imgY >= y + h - handleSize && imgY <= y + h + handleSize) return { handle: 'se', ...bboxResult };
    
    // Check edges
    if (imgX >= x - handleSize && imgX <= x + w + handleSize && 
        imgY >= y - handleSize && imgY <= y + handleSize) return { handle: 'n', ...bboxResult };
    if (imgX >= x - handleSize && imgX <= x + w + handleSize && 
        imgY >= y + h - handleSize && imgY <= y + h + handleSize) return { handle: 's', ...bboxResult };
    if (imgX >= x - handleSize && imgX <= x + handleSize && 
        imgY >= y - handleSize && imgY <= y + h + handleSize) return { handle: 'w', ...bboxResult };
    if (imgX >= x + w - handleSize && imgX <= x + w + handleSize && 
        imgY >= y - handleSize && imgY <= y + h + handleSize) return { handle: 'e', ...bboxResult };
    
    return null;
  };

  // Get cursor for resize handle
  const getResizeCursor = (handle) => {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nw-resize';
      case 'ne':
      case 'sw':
        return 'ne-resize';
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      default:
        return 'default';
    }
  };

  // Check if all keypoints are placed for a skeleton object (for skeleton interaction)
  const areAllKeypointsPlaced = (skeletonObj = null) => {
    if (skeletonObj && skeletonObj.keypoints) {
      return skeletonObj.keypoints.every(pt => pt !== null && pt !== undefined);
    }
    
    // Default behavior for single animal mode or current working skeleton
    const ann = annotations[currentFrame] || {};
    if (!ann.keypoints) return false;
    return ann.keypoints.every(pt => pt !== null && pt !== undefined);
  };

  // Find if point is near skeleton lines (not keypoints) - SEPARATE logic for single vs multi-animal modes
  const findSkeletonHover = (imgX, imgY) => {
    const frameAnn = annotations[currentFrame] || {};
    const threshold = 8 / scale.current;
    const keypointThreshold = KEYPOINT_RADIUS / scale.current + 2;
    
    if (multiAnimalMode) {
      // MULTI-ANIMAL MODE: Each skeleton is completely separate
      const skeletons = frameAnn.skeletons || [];
      
      // Check completed skeletons (each has unique object key)
      for (let skeletonIndex = 0; skeletonIndex < skeletons.length; skeletonIndex++) {
        const skeleton = skeletons[skeletonIndex];
        if (!areAllKeypointsPlaced(skeleton) || skeleton.hidden) continue;
        
        // First check if near any keypoint of this skeleton - if so, skip skeleton hover
        let nearKeypoint = false;
        for (let i = 0; i < skeleton.keypoints.length; i++) {
          const pt = skeleton.keypoints[i];
      if (!pt) continue;
      
      const dx = pt.x - imgX;
      const dy = pt.y - imgY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < keypointThreshold) {
            nearKeypoint = true;
            break;
      }
    }
    
        if (nearKeypoint) continue;
    
        // Check skeleton lines for hover
    for (const [idx1, idx2] of skeletonConnections) {
          const pt1 = skeleton.keypoints[idx1];
          const pt2 = skeleton.keypoints[idx2];
      
      if (!pt1 || !pt2) continue;
      
          const vis1 = skeleton.visibilities ? skeleton.visibilities[idx1] : 2;
          const vis2 = skeleton.visibilities ? skeleton.visibilities[idx2] : 2;
      
          if (vis1 === 0 || vis2 === 0) continue;
      
      // Calculate distance from point to line segment
      const dx = pt2.x - pt1.x;
      const dy = pt2.y - pt1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length === 0) continue;
      
      const t = Math.max(0, Math.min(1, ((imgX - pt1.x) * dx + (imgY - pt1.y) * dy) / (length * length)));
      const projection = {
        x: pt1.x + t * dx,
        y: pt1.y + t * dy
      };
      
      const distance = Math.sqrt((imgX - projection.x) ** 2 + (imgY - projection.y) ** 2);
      
      if (distance <= threshold) {
            return {
              skeletonId: skeleton.id,
              objKey: `completed_skeleton_${skeletonIndex}`, // Unique object key
              objectType: 'completed_skeleton',
              objectIndex: skeletonIndex,
              keypoints: skeleton.keypoints,
              visibilities: skeleton.visibilities
            };
          }
        }
      }
      
      // Check current working skeleton
      if (frameAnn.keypoints && areAllKeypointsPlaced() && !frameAnn.skeletonHidden) {
        // First check if near any keypoint of working skeleton
        let nearKeypoint = false;
        for (let i = 0; i < frameAnn.keypoints.length; i++) {
          const pt = frameAnn.keypoints[i];
          if (!pt) continue;
          
          const dx = pt.x - imgX;
          const dy = pt.y - imgY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < keypointThreshold) {
            nearKeypoint = true;
            break;
          }
        }
        
        if (!nearKeypoint) {
          // Check working skeleton lines for hover
          for (const [idx1, idx2] of skeletonConnections) {
            const pt1 = frameAnn.keypoints[idx1];
            const pt2 = frameAnn.keypoints[idx2];
            
            if (!pt1 || !pt2) continue;
            
            const vis1 = frameAnn.visibilities ? frameAnn.visibilities[idx1] : 2;
            const vis2 = frameAnn.visibilities ? frameAnn.visibilities[idx2] : 2;
            
            if (vis1 === 0 || vis2 === 0) continue;
            
            // Calculate distance from point to line segment
            const dx = pt2.x - pt1.x;
            const dy = pt2.y - pt1.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length === 0) continue;
            
            const t = Math.max(0, Math.min(1, ((imgX - pt1.x) * dx + (imgY - pt1.y) * dy) / (length * length)));
            const projection = {
              x: pt1.x + t * dx,
              y: pt1.y + t * dy
            };
            
            const distance = Math.sqrt((imgX - projection.x) ** 2 + (imgY - projection.y) ** 2);
            
            if (distance <= threshold) {
              const workingSkeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId;
              return {
                skeletonId: workingSkeletonId,
                objKey: 'working_skeleton', // Unique object key
                objectType: 'working_skeleton',
                objectIndex: null,
                keypoints: frameAnn.keypoints,
                visibilities: frameAnn.visibilities
              };
            }
          }
        }
      }
      
      return null;
      
    } else {
      // SINGLE ANIMAL MODE: Original logic unchanged
      if (!frameAnn.keypoints || !areAllKeypointsPlaced()) return null;
      
      // First check if near any keypoint - if so, don't consider skeleton hover
      for (let i = 0; i < frameAnn.keypoints.length; i++) {
        const pt = frameAnn.keypoints[i];
        if (!pt) continue;
        
        const dx = pt.x - imgX;
        const dy = pt.y - imgY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < keypointThreshold) {
          return null;
        }
      }
      
      // Check skeleton lines for hover
      for (const [idx1, idx2] of skeletonConnections) {
        const pt1 = frameAnn.keypoints[idx1];
        const pt2 = frameAnn.keypoints[idx2];
        
        if (!pt1 || !pt2) continue;
        
        const vis1 = frameAnn.visibilities ? frameAnn.visibilities[idx1] : 2;
        const vis2 = frameAnn.visibilities ? frameAnn.visibilities[idx2] : 2;
        
        if (vis1 === 0 || vis2 === 0) continue;
        
        // Calculate distance from point to line segment
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length === 0) continue;
        
        const t = Math.max(0, Math.min(1, ((imgX - pt1.x) * dx + (imgY - pt1.y) * dy) / (length * length)));
        const projection = {
          x: pt1.x + t * dx,
          y: pt1.y + t * dy
        };
        
        const distance = Math.sqrt((imgX - projection.x) ** 2 + (imgY - projection.y) ** 2);
        
        if (distance <= threshold) {
          return {
            skeletonId: frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0,
            keypoints: frameAnn.keypoints,
            visibilities: frameAnn.visibilities
          };
        }
      }
      
      return null;
    }
  };

  // Check if a point is inside a rectangle
  const isPointInRect = (px, py, rx, ry, rw, rh) => {
    // Convert image coordinates to canvas coordinates for comparison
    const { x: canvasX, y: canvasY } = mapToCanvasCoords(px, py);
    return canvasX >= rx && canvasX <= rx + rw && canvasY >= ry && canvasY <= ry + rh;
  };

  // Get objects inside selection rectangle - works with both modes
  const getObjectsInSelection = (rect) => {
    const frameAnn = annotations[currentFrame] || {};
    const selected = {
      keypoints: new Set(),
      bboxes: new Set(),
      skeletons: new Set()
    };
    
    if (multiAnimalMode) {
      // Multi-animal mode: check all objects
      const skeletons = frameAnn.skeletons || [];
      const bboxes = frameAnn.bboxes || [];
      
      // Check skeleton keypoints
      skeletons.forEach((skeleton, skeletonIndex) => {
        if (!skeleton.keypoints) return;
        let allKeypointsSelected = true;
        let anyKeypointSelected = false;
        const selectedKeypointsForSkeleton = [];
        
        skeleton.keypoints.forEach((pt, idx) => {
          if (!pt) {
            allKeypointsSelected = false;
            return;
          }
          if (isPointInRect(pt.x, pt.y, rect.x, rect.y, rect.w, rect.h)) {
            selectedKeypointsForSkeleton.push(idx);
            anyKeypointSelected = true;
          } else {
            allKeypointsSelected = false;
          }
        });
        
        // Only select the entire skeleton if ALL its keypoints are within the selection rectangle
        if (allKeypointsSelected && anyKeypointSelected) {
          selected.skeletons.add(`completed_skeleton_${skeletonIndex}`);
        } else if (anyKeypointSelected) {
          // Only select individual keypoints if not selecting the whole skeleton
          selectedKeypointsForSkeleton.forEach(idx => {
            const skeletonKeypointKey = `completed_skeleton_${skeletonIndex}_${idx}`;
            selected.keypoints.add(skeletonKeypointKey);
          });
        }
      });
      
      // Check current working skeleton keypoints
      if (frameAnn.keypoints) {
        const skeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : currentSkeletonId;
        let allKeypointsSelected = true;
        let anyKeypointSelected = false;
        const selectedKeypointsForWorkingSkeleton = [];
        
        frameAnn.keypoints.forEach((pt, idx) => {
          if (!pt) {
            allKeypointsSelected = false;
            return;
          }
          if (isPointInRect(pt.x, pt.y, rect.x, rect.y, rect.w, rect.h)) {
            selectedKeypointsForWorkingSkeleton.push(idx);
            anyKeypointSelected = true;
          } else {
            allKeypointsSelected = false;
          }
        });
        
        // Only select the entire working skeleton if ALL its keypoints are within the selection rectangle
        if (allKeypointsSelected && anyKeypointSelected) {
          selected.skeletons.add('working_skeleton');
        } else if (anyKeypointSelected) {
          // Only select individual keypoints if not selecting the whole skeleton
          selectedKeypointsForWorkingSkeleton.forEach(idx => {
            const skeletonKeypointKey = `working_skeleton_${idx}`;
            selected.keypoints.add(skeletonKeypointKey);
          });
        }
      }
      
      // Check bboxes - only select if the box itself is in the selection rectangle
      bboxes.forEach((bboxObj, bboxIndex) => {
        if (!bboxObj.bbox) return;
        const [bx, by, bw, bh] = bboxObj.bbox;
        
        // Check if any corner of the box is inside the selection rectangle
        const corners = [
          { x: bx, y: by },               // Top-left
          { x: bx + bw, y: by },          // Top-right
          { x: bx, y: by + bh },          // Bottom-left
          { x: bx + bw, y: by + bh }      // Bottom-right
        ];
        
        // Also check the center point
        corners.push({ x: bx + bw/2, y: by + bh/2 });
        
        // If any corner or the center is inside the selection rectangle, select the box
        if (corners.some(corner => isPointInRect(corner.x, corner.y, rect.x, rect.y, rect.w, rect.h))) {
          const objKey = `completed_bbox_${bboxIndex}`;
          selected.bboxes.add(objKey);
        }
      });
      
      // Check current working bbox
      if (frameAnn.bbox) {
        const [bx, by, bw, bh] = frameAnn.bbox;
        const bboxCenterX = bx + bw / 2;
        const bboxCenterY = by + bh / 2;
        if (isPointInRect(bboxCenterX, bboxCenterY, rect.x, rect.y, rect.w, rect.h)) {
          selected.bboxes.add('working_bbox');
        }
      }
    } else {
      // Single animal mode: legacy behavior
      if (frameAnn.keypoints) {
        const skeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0;
        let allKeypointsSelected = true;
        let anyKeypointSelected = false;
        
        frameAnn.keypoints.forEach((pt, idx) => {
          if (!pt) {
            allKeypointsSelected = false;
            return;
          }
          if (isPointInRect(pt.x, pt.y, rect.x, rect.y, rect.w, rect.h)) {
            const objKey = `${skeletonId}_${idx}`;
            selected.keypoints.add(objKey);
            anyKeypointSelected = true;
          } else {
            allKeypointsSelected = false;
          }
        });
        
        if (allKeypointsSelected && anyKeypointSelected) {
          selected.skeletons.add(`${skeletonId}`);
        }
      }
      
      if (frameAnn.bbox) {
        const bboxId = frameAnn.bboxId !== undefined ? frameAnn.bboxId : 0;
        const [bx, by, bw, bh] = frameAnn.bbox;
        const bboxCenterX = bx + bw / 2;
        const bboxCenterY = by + bh / 2;
        if (isPointInRect(bboxCenterX, bboxCenterY, rect.x, rect.y, rect.w, rect.h)) {
          selected.bboxes.add(bboxId);
        }
      }
    }
    
    return selected;
  };

  // Helper function to get keypoint from objKey
  const getKeypointFromObjKey = (objKey) => {
    const frameAnn = annotations[currentFrame] || {};
    if (multiAnimalMode) {
      const info = getObjKeyInfo(objKey, frameAnn, currentSkeletonId);
      if (info.pattern === 'completed' && info.skeletonIndex !== null) {
        const sk = (frameAnn.skeletons || [])[info.skeletonIndex];
        if (sk && sk.keypoints && sk.keypoints[info.kpIdx]) return sk.keypoints[info.kpIdx];
      } else if (info.pattern === 'working') {
        if (frameAnn.keypoints && frameAnn.keypoints[info.kpIdx]) return frameAnn.keypoints[info.kpIdx];
      } else {
        // legacy fallback
        const skeletons = frameAnn.skeletons || [];
        const sIdx = skeletons.findIndex(s => s.id === info.skeletonId);
        if (sIdx >= 0) {
          const sk = skeletons[sIdx];
          if (sk.keypoints && sk.keypoints[info.kpIdx]) return sk.keypoints[info.kpIdx];
        }
        if (frameAnn.keypoints && (frameAnn.skeletonId === info.skeletonId || (frameAnn.skeletonId === undefined && info.skeletonId === currentSkeletonId))) {
          return frameAnn.keypoints[info.kpIdx];
        }
      }
    } else {
      // Single animal mode
      const match = objKey.match(/(\d+)_(\d+)$/);
      if (match && frameAnn.keypoints && frameAnn.keypoints[Number(match[2])]) {
        return frameAnn.keypoints[Number(match[2])];
      }
    }
    return null;
  };

  // Helper function to get current bbox
  const getCurrentBbox = () => {
    const frameAnn = annotations[currentFrame] || {};
    
    if (multiAnimalMode) {
      // In multi-animal mode, we need to identify which bbox is selected
      // For now, return the current working bbox
      return frameAnn.bbox;
    } else {
      // Single animal mode
      return frameAnn.bbox;
    }
  };

  // Load image
  useEffect(() => {
    if (!imageUrl) return;
    
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      imageRef.current = img;
      
      // Auto-fit image to container when first loaded
      const container = containerRef.current;
      if (container) {
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        
        // Calculate scale to fit entire image in container
        const scaleToFit = Math.min(containerW / imgW, containerH / imgH);
        
        // Apply the fit scale and center the image
        scale.current = scaleToFit;
        offset.current = { x: 0, y: 0 }; // Center the image
      }
      
      draw();
    };
  }, [imageUrl]);

  // Redraw when annotations change
  useEffect(() => {
    draw();
  }, [annotations, currentFrame, mode, keypointIndex, hoveredSidebarObject, selectedImageObjects, selectedBbox, selectedSkeleton]);

  // Clear selections when frame changes
  useEffect(() => {
    setSelectedBbox(false);
    selectedKeypoints.current.clear();
    keypointSelectionType.current.clear(); // Clear selection type tracking
    setSelectedSkeleton(false);
    // Clean up any drag states
    selectedKeypoint.current = null;
    dragStartPos.current = null;
    multiKeypointDragStart.current = null;
    multiKeypointOriginalPositions.current = null;
    bboxDragStart.current = null;
    bboxOriginal.current = null;
    // Clear multi-animal selection tracking
    if (multiAnimalMode) {
      selectedObjectsMA.current.clear();
      setSelectedImageObjects && setSelectedImageObjects(new Set());
    }
  }, [currentFrame, setSelectedBbox, setSelectedSkeleton, multiAnimalMode, setSelectedImageObjects]);

  // Helper function to sync selection state with sidebar
  const syncSelectionToSidebar = () => {
    if (multiAnimalMode && setSelectedImageObjects) {
      setSelectedImageObjects(new Set(selectedObjectsMA.current));
    }
  };

  // Redraw on resize
  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Set cursor based on mode and state
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    if (spacePressed.current) {
      canvas.style.cursor = panning.current ? 'grabbing' : 'grab';
    } else if (mode === 'keypoint') {
      canvas.style.cursor = CIRCLE_CURSOR;
    } else if (mode === 'bbox') {
      canvas.style.cursor = 'crosshair';
    } else if (dragActive.current || bboxDragActive.current || resizingBbox.current || draggingSkeleton.current || dragSelecting.current || draggingMultipleKeypoints.current || draggingMultipleObjects.current) {
      if (resizingBbox.current && resizeHandle.current) {
        canvas.style.cursor = getResizeCursor(resizeHandle.current);
      } else if (dragSelecting.current) {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'grabbing';
      }
    } else {
      canvas.style.cursor = 'default';
    }
  }, [mode, dragActive.current, bboxDragActive.current, resizingBbox.current, panning.current, spacePressed.current]);

  // Main event handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get mouse position in canvas coordinates
    const getCanvasPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
        y: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
      };
    };

    // Mouse down
    const handleMouseDown = (e) => {
      e.preventDefault(); // Prevent browser default drag behavior
      
      // Blur any focused input elements (like sidebar text inputs)
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
      
      const canvasPos = getCanvasPos(e);
      const imagePos = mapToImageCoords(canvasPos.x, canvasPos.y);
      

      
      // Reset movement tracking
      mouseDownPos.current = canvasPos;
      hasMoved.current = false;
      mouseUpHandled.current = false;

      if (spacePressed.current) {
        // Start panning
        panning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        offsetStart.current = { ...offset.current };
        canvas.style.cursor = 'grabbing';
      } else if (mode === 'bbox') {
        // Start drawing box - clear selections
        clearAllSelections();
        drawing.current = true;
        startPoint.current = imagePos;
        currentBox.current = { x: imagePos.x, y: imagePos.y, w: 0, h: 0 };
        draw();
      } else if (mode === 'keypoint') {
        // Place keypoint (handled in click event)
      } else {
        // Check for interactions (higher priority first)
        const keypointResult = findKeypoint(imagePos.x, imagePos.y);
        const resizeHandleResult = findBboxResizeHandle(imagePos.x, imagePos.y);
        const skeletonResult = findSkeletonHover(imagePos.x, imagePos.y);
        const bboxResult = findBbox(imagePos.x, imagePos.y);
        const ctrlPressed = e.ctrlKey || e.metaKey;
        

        
        if (resizeHandleResult) {
          // Start bbox resizing (highest priority) - track original selection state
          if (!multiAnimalMode) {
            originalBboxSelected.current = selectedBbox;
          }
          clearAllSelections();
          resizingBbox.current = true;
          // Save to undo stack BEFORE starting bbox resize operation
          saveToUndoStack && saveToUndoStack();
          resizeHandle.current = resizeHandleResult.handle;
          bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
          resizeStartBbox.current = [...resizeHandleResult.bbox];
          // Store bbox info for resize operations (important for multi-animal mode)
          resizeBboxInfo.current = {
            bboxId: resizeHandleResult.bboxId,
            bbox: resizeHandleResult.bbox,
            objKey: resizeHandleResult.objKey,
            objectType: resizeHandleResult.objectType,
            objectIndex: resizeHandleResult.objectIndex
          };
          canvas.style.cursor = getResizeCursor(resizeHandleResult.handle);
        } else if (keypointResult) {
          // Keypoint interaction - will be handled in click or drag logic

          if (ctrlPressed) {
            // Ctrl+click for selection only - handle in click event, don't clear other selections
          } else {
            if (multiAnimalMode) {
              // MULTI-ANIMAL MODE: Enhanced multi-object selection handling
              const keypointObjKey = keypointResult.objKey;
              
              // Check if this keypoint is already in the multi-animal selection
              const isAlreadySelected = isSelectedInMultiAnimal(keypointObjKey);
              
              // Check if we have multiple objects selected (in selectedObjectsMA)
              if (isAlreadySelected && selectedObjectsMA.current.size > 1) {
                // Prepare for multi-object dragging in multi-animal mode
                multiObjectDragStartMA.current = { x: imagePos.x, y: imagePos.y };
                multiObjectOriginalPositionsMA.current = getSelectedObjectPositions();
                
                // Store original selection states for all selected keypoints
                originalKeypointSelections.current.clear();
                selectedObjectsMA.current.forEach(objKey => {
                  if (objKey.includes('keypoint') || objKey.includes('skeleton_') && objKey.split('_').length > 3) {
                    originalKeypointSelections.current.set(objKey, true); // All are already selected
                  }
                });
                
                // Don't start dragging immediately - wait to see if user moves mouse
                // CRITICAL: Don't set selectedKeypoint.current for multi-object drags
              } else {
                // Single keypoint selection/drag preparation
                selectedKeypoint.current = keypointResult;
                dragStartPos.current = { ...keypointResult.keypoint };
                
                // CRITICAL FIX: Save to undo stack IMMEDIATELY when keypoint is selected for dragging
                // This ensures we save the ORIGINAL position before any movement
                saveToUndoStack && saveToUndoStack();
                
                // Store original selection state for this keypoint
                originalKeypointSelections.current.clear();
                originalKeypointSelections.current.set(keypointObjKey, isAlreadySelected);
                
                // If not already selected, select it and clear others
                if (!isAlreadySelected) {
                  selectedObjectsMA.current.clear();
                  selectedKeypoints.current.clear();
                  addToMultiAnimalSelection(keypointObjKey);
                  selectedKeypoints.current.add(keypointObjKey);
                  setSelectedBbox(false);
                  setSelectedSkeleton(false);
                }
              }
            } else {
              // SINGLE ANIMAL MODE: Original logic
              // Check if we have multiple objects selected for multi-object dragging
              if (selectedKeypoints.current.has(keypointResult.objKey) && (selectedKeypoints.current.size > 1 || selectedBbox)) {
                // Multi-object drag (keypoints + potentially bbox)
                multiKeypointDragStart.current = { x: imagePos.x, y: imagePos.y };
                multiKeypointOriginalPositions.current = new Map();
                // Store original positions of all selected keypoints
                selectedKeypoints.current.forEach(objKey => {
                  // Parse objKey to get skeletonId and idx
                  const [skeletonId, idx] = objKey.split('_').map(Number);
                  const kp = getKeypointFromObjKey(objKey);
                  if (kp) {
                    multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                  }
                });
                // Store bbox position if bbox is also selected
                if (selectedBbox) {
                  const currentBbox = getCurrentBbox();
                  if (currentBbox) {
                  bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
                    bboxOriginal.current = [...currentBbox];
                  }
                }
              } else {
                // Single keypoint drag preparation
                const keypointObjKey = keypointResult.objKey;
                const isAlreadySelected = selectedKeypoints.current.has(keypointObjKey);
                
                // Store original selection state for this keypoint
                originalKeypointSelections.current.clear();
                originalKeypointSelections.current.set(keypointObjKey, isAlreadySelected);
                
                // If keypoint wasn't selected, select it now and clear other selections
                if (!isAlreadySelected) {
                  selectedKeypoints.current.clear();
                  selectedKeypoints.current.add(keypointObjKey);
                  setSelectedBbox(false);
                  setSelectedSkeleton(false);
                }
                
                // Single keypoint drag preparation
                selectedKeypoint.current = keypointResult;
                dragStartPos.current = { ...keypointResult.keypoint };
                
                // CRITICAL FIX: Save to undo stack IMMEDIATELY when keypoint is selected for dragging
                // This ensures we save the ORIGINAL position before any movement
                saveToUndoStack && saveToUndoStack();
              }
            }
            // Don't start dragging immediately - wait to see if user moves mouse
          }
        } else if (skeletonResult && areAllKeypointsPlaced(skeletonResult)) {
          // Skeleton interaction - prepare for dragging (similar to bbox logic)
          if (ctrlPressed) {
            // Ctrl+click for multi-selection - don't start dragging, handle in click event
            // In multi-animal mode, check actual selected objects, not highlight-only keypoints
            if (multiAnimalMode) {
              // Check if we have multiple objects selected (not including highlight-only keypoints)
              if (selectedObjectsMA.current.size > 1) {
                // Multi-object drag preparation - use NEW multi-animal system
                multiObjectDragStartMA.current = { x: imagePos.x, y: imagePos.y };
                multiObjectOriginalPositionsMA.current = getSelectedObjectPositions();
                
                // Store original selection states for all selected objects
                originalSkeletonSelections.current.clear();
                originalBboxSelections.current.clear();
                originalKeypointSelections.current.clear();
                
                selectedObjectsMA.current.forEach(objKey => {
                  if (objKey.includes('skeleton')) {
                    originalSkeletonSelections.current.set(objKey, true); // All are already selected
                  } else if (objKey.includes('bbox')) {
                    originalBboxSelections.current.set(objKey, true);
                  } else if (objKey.includes('keypoint') || (objKey.includes('skeleton_') && objKey.split('_').length > 3)) {
                    originalKeypointSelections.current.set(objKey, true);
                  }
                });
                
                // Don't start dragging immediately - wait to see if user moves mouse
              } else {
                // Single skeleton - just store drag start position
                skeletonDragStart.current = { x: imagePos.x, y: imagePos.y };
              }
            } else {
              // Single animal mode: use original logic based on selectedKeypoints
              if (selectedKeypoints.current.size > 0) {
                // Multi-object drag preparation (skeleton + keypoints)
                multiKeypointDragStart.current = { x: imagePos.x, y: imagePos.y };
                draggingMultipleObjects.current = false;  // Will be set to true when drag starts
                
                // Store original positions for all selected objects
                multiKeypointOriginalPositions.current = new Map();
                
                // Store positions of selected keypoints
                selectedKeypoints.current.forEach(objKey => {
                  const kp = getKeypointFromObjKey(objKey);
                  if (kp) {
                    multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                  }
                });
                
                // Store skeleton positions
                const currentAnn = annotations[currentFrame] || {};
                const currentKeypoints = currentAnn.keypoints || [];
                skeletonOriginalPositions.current = currentKeypoints.map(pt => pt ? { ...pt } : null);
              } else {
                // Just store drag start position in case user starts dragging
                skeletonDragStart.current = { x: imagePos.x, y: imagePos.y };
              }
            }
          } else {
            // Check if we have multi-object selection (skeleton + bbox or skeleton + keypoints)
            let skeletonIsSelected = selectedSkeleton;
            
            // In multi-animal mode, check if this specific skeleton is selected
            if (multiAnimalMode && skeletonResult.objKey) {
              skeletonIsSelected = selectedObjectsMA.current.has(skeletonResult.objKey);
            }
            
            // Check for multi-object selection in multi-animal mode (NEW)
            if (multiAnimalMode && selectedObjectsMA.current.size > 1 && skeletonIsSelected) {
              // Multiple objects selected (skeletons, bboxes, or mix) - use new multi-animal multi-object drag system
              multiObjectDragStartMA.current = { x: imagePos.x, y: imagePos.y };
              multiObjectOriginalPositionsMA.current = getSelectedObjectPositions();
              
              // Store original selection states for all selected objects
              originalSkeletonSelections.current.clear();
              originalBboxSelections.current.clear();
              originalKeypointSelections.current.clear();
              
              selectedObjectsMA.current.forEach(objKey => {
                if (objKey.includes('skeleton')) {
                  originalSkeletonSelections.current.set(objKey, true); // All are already selected
                } else if (objKey.includes('bbox')) {
                  originalBboxSelections.current.set(objKey, true);
                } else if (objKey.includes('keypoint') || (objKey.includes('skeleton_') && objKey.split('_').length > 3)) {
                  originalKeypointSelections.current.set(objKey, true);
                }
              });
              
              // Don't start dragging immediately - wait to see if user moves mouse
            } else if (!multiAnimalMode && ((skeletonIsSelected && selectedBbox) || (skeletonIsSelected && selectedKeypoints.current.size > 0))) {
              // Single animal mode: Multi-object drag (skeleton + bbox together or skeleton + keypoints together)
              multiKeypointDragStart.current = { x: imagePos.x, y: imagePos.y };
              
              // Handle bbox if selected
              if (selectedBbox) {
                bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
                const currentAnn = annotations[currentFrame] || {};
                bboxOriginal.current = currentAnn.bbox ? [...currentAnn.bbox] : null;
              }
              
              // Store all keypoint positions for skeleton dragging
              multiKeypointOriginalPositions.current = new Map();
              
              // Store positions of selected keypoints
              selectedKeypoints.current.forEach(objKey => {
                const kp = getKeypointFromObjKey(objKey);
                if (kp) {
                  multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                }
              });
              
              // Single animal mode: use current keypoints
              const currentAnn = annotations[currentFrame] || {};
              const currentKeypoints = currentAnn.keypoints || [];
              currentKeypoints.forEach((kp, idx) => {
                if (kp) {
                    const objKey = `${currentAnn.skeletonId || 0}_${idx}`;
                    multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                }
              });
            } else {
              // Handle skeleton selection based on mode
              if (multiAnimalMode) {
                // Multi-animal mode: check if this specific skeleton is selected
                const skeletonObjKey = skeletonResult.objKey;
                const isAlreadySelected = selectedObjectsMA.current.has(skeletonObjKey);
                
                // Store original selection state for this skeleton
                originalSkeletonSelections.current.clear();
                originalSkeletonSelections.current.set(skeletonObjKey, isAlreadySelected);
                
                if (!isAlreadySelected) {
                  // Select this skeleton and clear other selections
                  selectedObjectsMA.current.clear();
                  selectedObjectsMA.current.add(skeletonObjKey);
                  selectedKeypoints.current.clear();
                  setSelectedBbox(false);
                  setSelectedSkeleton(true); // Keep legacy state for drawing compatibility
                }
              } else {
                // Single animal mode: original logic
                const wasSkeletonSelected = selectedSkeleton;
                
                // Store original selection state for skeleton
                originalSkeletonSelections.current.clear();
                originalSkeletonSelections.current.set('single_skeleton', wasSkeletonSelected);
                
                if (!selectedSkeleton) {
                  setSelectedSkeleton(true);
                  selectedKeypoints.current.clear();
                  setSelectedBbox(false);
                }
              }
              
              // Prepare for dragging (but don't start immediately)
              skeletonDragStart.current = { x: imagePos.x, y: imagePos.y };
              // Record which skeleton is being dragged so we update correct array
              draggingSkeletonInfo.current = multiAnimalMode ? {
                type: skeletonResult.objectType, // 'completed_skeleton' | 'working_skeleton'
                skeletonIndex: skeletonResult.objectIndex,
                skeletonId: skeletonResult.skeletonId
              } : { type: 'single' };
              
                          if (multiAnimalMode) {
              // Multi-animal mode: use skeleton from skeletonResult
              skeletonOriginalPositions.current = skeletonResult.keypoints.map(pt => pt ? { ...pt } : null);
              
              // CRITICAL: If dragging a completed skeleton, immediately clear any working skeleton with same ID
              if (skeletonResult.objectType === 'completed_skeleton') {
                const completedSkeletonId = skeletonResult.skeletonId;
                const currentAnn = annotations[currentFrame] || {};
                const workingSkeletonId = currentAnn.skeletonId !== undefined ? currentAnn.skeletonId : currentSkeletonId;
                
                if (workingSkeletonId === completedSkeletonId && currentAnn.keypoints) {
                  // Clear conflicting working skeleton data immediately
                  setAnnotations(prev => {
                    const next = [...prev];
                    const ann = next[currentFrame] || {};
                    const { keypoints: _kp, visibilities: _vis, skeletonId: _sid, ...restAnn } = ann;
                    next[currentFrame] = restAnn;
                    return next;
                  });
                }
              }
            } else {
                // Single animal mode: use current annotation keypoints
              const currentAnn = annotations[currentFrame] || {};
              const currentKeypoints = currentAnn.keypoints || [];
              skeletonOriginalPositions.current = currentKeypoints.map(pt => pt ? { ...pt } : null);
            }
          }
          }
        } else if (bboxResult) {
          // Bbox interaction - prepare for dragging on any bbox click
          if (ctrlPressed) {
            // Ctrl+click for multi-selection - don't start dragging, handle in click event
          } else {
            if (multiAnimalMode) {
              // MULTI-ANIMAL MODE: Enhanced bbox multi-object selection handling
              const bboxObjKey = bboxResult.objKey;
              
              // Check if this bbox is already in the multi-animal selection
              const isAlreadySelected = isSelectedInMultiAnimal(bboxObjKey);
              
              // Check if we have multiple objects selected (in selectedObjectsMA)
              if (isAlreadySelected && selectedObjectsMA.current.size > 1) {
                // Prepare for multi-object dragging in multi-animal mode
                multiObjectDragStartMA.current = { x: imagePos.x, y: imagePos.y };
                multiObjectOriginalPositionsMA.current = getSelectedObjectPositions();
                
                // Store original selection states for all selected objects
                originalSkeletonSelections.current.clear();
                originalBboxSelections.current.clear();
                originalKeypointSelections.current.clear();
                
                selectedObjectsMA.current.forEach(objKey => {
                  if (objKey.includes('skeleton')) {
                    originalSkeletonSelections.current.set(objKey, true); // All are already selected
                  } else if (objKey.includes('bbox')) {
                    originalBboxSelections.current.set(objKey, true);
                  } else if (objKey.includes('keypoint') || (objKey.includes('skeleton_') && objKey.split('_').length > 3)) {
                    originalKeypointSelections.current.set(objKey, true);
                  }
                });
                
                // Don't start dragging immediately - wait to see if user moves mouse
              } else {
                // Single bbox selection/drag preparation
                selectedBboxRef.current = bboxResult;
                bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
                bboxOriginal.current = [...bboxResult.bbox];
                
                // Store original selection state for this bbox
                originalBboxSelections.current.clear();
                originalBboxSelections.current.set(bboxObjKey, isAlreadySelected);
                
                // If not already selected, select it and clear others
                if (!isAlreadySelected) {
                  selectedObjectsMA.current.clear();
                  selectedKeypoints.current.clear();
                  addToMultiAnimalSelection(bboxObjKey);
                  setSelectedBbox(true);
                  setSelectedSkeleton(false);
                }
              }
            } else {
              // SINGLE ANIMAL MODE: Check if we have multiple objects selected for multi-object dragging
              if (selectedBbox && (selectedKeypoints.current.size > 0 || selectedSkeleton)) {
                // Multi-object drag preparation (keypoints/skeleton + bbox together)
                multiKeypointDragStart.current = { x: imagePos.x, y: imagePos.y };
                bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
                const currentAnn = annotations[currentFrame] || {};
                bboxOriginal.current = currentAnn.bbox ? [...currentAnn.bbox] : null;
                
                // Store keypoint positions based on selected objects
                multiKeypointOriginalPositions.current = new Map();
                if (selectedSkeleton) {
                  // Store all keypoints for skeleton dragging
                  const currentAnn = annotations[currentFrame] || {};
                  const currentKeypoints = currentAnn.keypoints || [];
                  currentKeypoints.forEach((kp, idx) => {
                    if (kp) {
                        const objKey = `${currentAnn.skeletonId || 0}_${idx}`;
                        multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                    }
                  });
                } else {
                  // Store only selected keypoints
                    selectedKeypoints.current.forEach(objKey => {
                      const kp = getKeypointFromObjKey(objKey);
                    if (kp) {
                        multiKeypointOriginalPositions.current.set(objKey, { ...kp });
                    }
                  });
                  }
              } else {
                // Regular bbox drag preparation (works for both selected and unselected bbox)
                // Track original selection state for single animal mode
                originalBboxSelected.current = selectedBbox;
                
                // If bbox wasn't selected, select it now and clear other selections
                if (!selectedBbox) {
                  setSelectedBbox(true);
                  selectedKeypoints.current.clear();
                  setSelectedSkeleton(false);
                }
                
                // Prepare for dragging
                selectedBboxRef.current = bboxResult;
                bboxDragStart.current = { x: imagePos.x, y: imagePos.y };
                bboxOriginal.current = [...bboxResult.bbox];
                // Don't set cursor to grabbing yet - wait for actual movement
              }
            }
          }
        } else {
          // Click on empty space - prepare for potential drag selection

          dragSelectStart.current = { x: canvasPos.x, y: canvasPos.y };
          dragSelectCtrl.current = ctrlPressed;
          
          // Don't clear selections immediately - wait to see if it's a drag or click
          if (!ctrlPressed) {
            // For non-Ctrl clicks, we'll clear selections if no drag happens
          }
        }
      }
    };

    // Mouse move
    const handleMouseMove = (e) => {
      e.preventDefault(); // Prevent browser default drag behavior
      const canvasPos = getCanvasPos(e);
      const imagePos = mapToImageCoords(canvasPos.x, canvasPos.y);
      
      // Track movement for drag detection
      if (mouseDownPos.current && !hasMoved.current) {
        const dx = canvasPos.x - mouseDownPos.current.x;
        const dy = canvasPos.y - mouseDownPos.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > DRAG_THRESHOLD) {
          hasMoved.current = true;
          // Movement detected - drag threshold exceeded
        }
      }

      // Update hover state - COMPLETELY SEPARATED logic for single vs multi-animal modes
      let needsRedraw = false;
      
      if (!mode && !dragActive.current && !bboxDragActive.current && !resizingBbox.current && !draggingSkeleton.current && !dragSelecting.current && !draggingMultipleKeypoints.current && !draggingMultipleObjects.current && !draggingMultiObjectsMA.current && !panning.current && !justClearedSelections.current && !justFinishedBboxDrag.current && !justFinishedBboxResize.current && !justFinishedSkeletonDrag.current && !justFinishedKeypointDrag.current && !justFinishedMultiDrag.current) {
        const hoveredKeypointResult = findKeypoint(imagePos.x, imagePos.y);
        const bboxHoveredResult = findBbox(imagePos.x, imagePos.y);
        const resizeHandleHoveredResult = findBboxResizeHandle(imagePos.x, imagePos.y);
        const skeletonHoveredResult = findSkeletonHover(imagePos.x, imagePos.y);
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Individual object tracking
          let newHoveredObject = null;
          
          // Priority: resize handle > keypoint > skeleton > bbox
          if (resizeHandleHoveredResult) {
            newHoveredObject = {
              type: 'resize_handle',
              objKey: bboxHoveredResult ? bboxHoveredResult.objKey : null,
              handle: resizeHandleHoveredResult.handle,
              bbox: resizeHandleHoveredResult.bbox
            };
          } else if (hoveredKeypointResult) {
            newHoveredObject = {
              type: 'keypoint',
              objKey: hoveredKeypointResult.objKey,
              idx: hoveredKeypointResult.idx,
              skeletonId: hoveredKeypointResult.skeletonId
            };
          } else if (skeletonHoveredResult) {
            newHoveredObject = {
              type: 'skeleton',
              objKey: skeletonHoveredResult.objKey,
              skeletonId: skeletonHoveredResult.skeletonId
            };
          } else if (bboxHoveredResult) {
            newHoveredObject = {
              type: 'bbox',
              objKey: bboxHoveredResult.objKey,
              bboxId: bboxHoveredResult.bboxId,
              objectType: bboxHoveredResult.objectType
            };
          }
          
          // Compare with current hovered object
          const currentObjKey = hoveredObjectMA.current ? hoveredObjectMA.current.objKey : null;
          const newObjKey = newHoveredObject ? newHoveredObject.objKey : null;
          const currentType = hoveredObjectMA.current ? hoveredObjectMA.current.type : null;
          const newType = newHoveredObject ? newHoveredObject.type : null;
          
          if (currentObjKey !== newObjKey || currentType !== newType) {
            hoveredObjectMA.current = newHoveredObject;
          needsRedraw = true;
            
            // Update sidebar highlighting
            if (setHoveredImageObject) {
              if (newHoveredObject && (newHoveredObject.type === 'bbox' || newHoveredObject.type === 'skeleton')) {
                setHoveredImageObject({ 
                  type: newHoveredObject.type === 'bbox' ? 'bbox' : 'skeleton', 
                  id: newHoveredObject.type === 'bbox' ? newHoveredObject.bboxId : newHoveredObject.skeletonId,
                  objKey: newHoveredObject.objKey
                });
              } else {
                setHoveredImageObject(null);
              }
            }
          }
          
          // Update cursor
          if (newHoveredObject) {
            if (newHoveredObject.type === 'resize_handle') {
              canvas.style.cursor = getResizeCursor(newHoveredObject.handle);
            } else if (newHoveredObject.type === 'bbox') {
              canvas.style.cursor = selectedObjectsMA.current.has(newHoveredObject.objKey) ? 'move' : 'pointer';
            } else if (newHoveredObject.type === 'keypoint') {
              canvas.style.cursor = 'pointer';
            } else if (newHoveredObject.type === 'skeleton') {
              canvas.style.cursor = 'move';
            }
          } else {
            canvas.style.cursor = 'default';
          }
        } else {
          // SINGLE ANIMAL MODE: Updated logic with skeleton priority over bbox
          // Compare keypoint hover by objKey
          const newKeypointHover = hoveredKeypointResult ? hoveredKeypointResult.objKey : null;
          const oldKeypointHover = hoveredKeypoint.current ? hoveredKeypoint.current.objKey : null;
          if (newKeypointHover !== oldKeypointHover) {
            hoveredKeypoint.current = hoveredKeypointResult;
            needsRedraw = true;
          }
          
          // Priority logic: skeleton > bbox (like multi-animal mode)
          let primaryHover = null;
          
          if (skeletonHoveredResult) {
            primaryHover = { type: 'skeleton', result: skeletonHoveredResult };
          } else if (bboxHoveredResult) {
            primaryHover = { type: 'bbox', result: bboxHoveredResult };
          }
          
          // Handle skeleton hover (higher priority)
          const newSkeletonHover = (primaryHover && primaryHover.type === 'skeleton') ? skeletonHoveredResult.skeletonId : null;
          const oldSkeletonHover = hoveredSkeleton.current ? hoveredSkeleton.current.skeletonId : null;
          if (newSkeletonHover !== oldSkeletonHover) {
            hoveredSkeleton.current = primaryHover && primaryHover.type === 'skeleton' ? skeletonHoveredResult : null;
            needsRedraw = true;
          }
          
          // Handle bbox hover (lower priority - only if no skeleton hover)
          const newBboxHover = (primaryHover && primaryHover.type === 'bbox') ? bboxHoveredResult.bboxId : null;
          const oldBboxHover = hoveredBbox.current ? hoveredBbox.current.bboxId : null;
          if (newBboxHover !== oldBboxHover) {
            hoveredBbox.current = primaryHover && primaryHover.type === 'bbox' ? bboxHoveredResult : null;
            needsRedraw = true;
          }
          
          // Update image hover state for sidebar highlighting (unified logic)
          if (setHoveredImageObject) {
            if (primaryHover) {
              if (primaryHover.type === 'skeleton') {
                setHoveredImageObject({ 
                  type: 'skeleton', 
                  id: skeletonHoveredResult.skeletonId,
                  objKey: 'working_skeleton'  // Fixed: Use working_skeleton for single animal mode
                });
              } else if (primaryHover.type === 'bbox') {
                setHoveredImageObject({ 
                  type: 'bbox', 
                  id: bboxHoveredResult.bboxId,
                  objKey: 'working_bbox'  // Fixed: Use working_bbox for single animal mode
                });
              }
            } else {
              setHoveredImageObject(null);
            }
          }
          
          // Update cursor based on what's hovered (priority order)
          if (resizeHandleHoveredResult) {
            canvas.style.cursor = getResizeCursor(resizeHandleHoveredResult.handle);
          } else if (bboxHoveredResult && selectedBbox) {
            canvas.style.cursor = 'move'; // Only show move cursor if bbox is selected
          } else if (bboxHoveredResult) {
            canvas.style.cursor = 'pointer'; // Show pointer for clickable bbox
          } else if (hoveredKeypointResult) {
            canvas.style.cursor = 'pointer';
          } else if (skeletonHoveredResult) {
            canvas.style.cursor = 'move';
          } else {
            canvas.style.cursor = 'default';
          }
        }
        
        if (needsRedraw) {
          draw(); // Redraw to show hover effect
        }
      } else {
        // Clear hover when in annotation mode or dragging
        if (multiAnimalMode) {
          if (hoveredObjectMA.current !== null) {
            hoveredObjectMA.current = null;
            needsRedraw = true;
          }
        } else {
          if (hoveredKeypoint.current !== null || hoveredBbox.current || hoveredSkeleton.current) {
        hoveredKeypoint.current = null;
            hoveredBbox.current = null;
            hoveredSkeleton.current = null;
            needsRedraw = true;
          }
        }
        
        // Clear image hover state
        if (setHoveredImageObject) {
          setHoveredImageObject(null);
        }
        
        if (needsRedraw) {
        draw();
        }
      }

      if (panning.current) {
        // Pan the view
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        offset.current.x = offsetStart.current.x + dx;
        offset.current.y = offsetStart.current.y + dy;
        draw();
      } else if (mode === 'bbox' && drawing.current) {
        // Update box being drawn
        const sx = startPoint.current.x;
        const sy = startPoint.current.y;
        currentBox.current = {
          x: Math.min(sx, imagePos.x),
          y: Math.min(sy, imagePos.y),
          w: Math.abs(imagePos.x - sx),
          h: Math.abs(imagePos.y - sy)
        };
        draw();
      } else if (multiAnimalMode && draggingMultiObjectsMA.current && multiObjectDragStartMA.current && hasMoved.current) {
        // MULTI-ANIMAL MODE: Enhanced multi-object dragging
        const dx = imagePos.x - multiObjectDragStartMA.current.x;
        const dy = imagePos.y - multiObjectDragStartMA.current.y;
        
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          const skeletons = ann.skeletons ? [...ann.skeletons] : [];
          const bboxes = ann.bboxes ? [...ann.bboxes] : [];
          let workingKeypoints = ann.keypoints ? [...ann.keypoints] : null;
          let workingBbox = ann.bbox ? [...ann.bbox] : null;
          
          // Update all selected objects using their stored original positions
          multiObjectOriginalPositionsMA.current.forEach((originalPos, objKey) => {
            if (objKey.startsWith('completed_skeleton_')) {
              const parts = objKey.split('_');
              if (parts.length === 4) {
                // Individual keypoint: completed_skeleton_X_Y  
                const skeletonIndex = parseInt(parts[2]);
                const keypointIndex = parseInt(parts[3]);
                if (skeletons[skeletonIndex] && skeletons[skeletonIndex].keypoints && skeletons[skeletonIndex].keypoints[keypointIndex]) {
                  skeletons[skeletonIndex].keypoints[keypointIndex] = {
                    x: originalPos.x + dx,
                    y: originalPos.y + dy
                  };
                }
              }
              // Note: Whole skeletons (3 parts) are handled by their individual keypoint entries
              // getSelectedObjectPositions() stores whole skeletons as individual keypoint entries like completed_skeleton_0_0, completed_skeleton_0_1, etc.
            } else if (objKey.startsWith('working_skeleton_')) {
              // Individual working keypoint
              const keypointIndex = parseInt(objKey.split('_')[2]);
              if (workingKeypoints && workingKeypoints[keypointIndex]) {
                workingKeypoints[keypointIndex] = {
                  x: originalPos.x + dx,
                  y: originalPos.y + dy
                };
              }
            } else if (objKey.startsWith('completed_bbox_')) {
              // Completed bbox
              const bboxIndex = parseInt(objKey.split('_')[2]);
              if (bboxes[bboxIndex]) {
                bboxes[bboxIndex].bbox = [
                  originalPos.x + dx,
                  originalPos.y + dy,
                  originalPos.w,
                  originalPos.h
                ];
              }
            } else if (objKey === 'working_bbox') {
              // Working bbox
              if (workingBbox) {
                workingBbox = [
                  originalPos.x + dx,
                  originalPos.y + dy,
                  originalPos.w,
                  originalPos.h
                ];
              }
            }
          });
          
          next[currentFrame] = {
            ...ann,
            skeletons,
            bboxes,
            keypoints: workingKeypoints,
            bbox: workingBbox
          };
          
          return next;
        });
      } else if (multiAnimalMode && multiObjectDragStartMA.current && hasMoved.current && !draggingMultiObjectsMA.current) {
        // MULTI-ANIMAL MODE: Start multi-object dragging when movement is detected
        draggingMultiObjectsMA.current = true;
        canvas.style.cursor = 'grabbing';
        // Save to undo stack BEFORE starting multi-object drag operation (same as single animal mode)
        saveToUndoStack && saveToUndoStack();
      } else if (!multiAnimalMode && multiKeypointDragStart.current && hasMoved.current && (selectedBbox || selectedSkeleton)) {
        // Start dragging multiple objects when movement is detected (includes skeleton + bbox or skeleton + keypoints)
        // CRITICAL: Only use OLD system in single-animal mode
        if (!draggingMultipleObjects.current) {
          draggingMultipleObjects.current = true;
          canvas.style.cursor = 'grabbing';
          // Save to undo stack BEFORE starting multi-object drag operation
          saveToUndoStack && saveToUndoStack();
        }
        
        // Calculate offset from start position
        const dx = imagePos.x - multiKeypointDragStart.current.x;
        const dy = imagePos.y - multiKeypointDragStart.current.y;
        
        // Drag all selected objects together
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          // Update keypoints - CRITICAL: This OLD system logic should ONLY run in single-animal mode
          if (multiKeypointOriginalPositions.current && multiKeypointOriginalPositions.current instanceof Map) {
            // Single animal mode: update current keypoints
            const kp = (ann.keypoints || Array(keypointLabels.length).fill(null)).slice();
            
            multiKeypointOriginalPositions.current.forEach((originalPos, objKey) => {
              const info = getObjKeyInfo(objKey, ann, currentSkeletonId);
              if (originalPos) {
                kp[info.kpIdx] = { x: originalPos.x + dx, y: originalPos.y + dy };
              }
            });
            
            next[currentFrame] = { 
              ...ann, 
              keypoints: kp,
              visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice() 
            };
          }
          
          // Update bbox position if selected
          if (selectedBbox && bboxOriginal.current) {
            if (multiAnimalMode && selectedBboxRef.current) {
              // Multi-animal mode: update specific bbox
              const bboxes = ann.bboxes ? [...ann.bboxes] : [];
            const [origX, origY, origW, origH] = bboxOriginal.current;
              const newBbox = [origX + dx, origY + dy, origW, origH];
              
              // Use the objectIndex from selectedBboxRef instead of searching by ID
              if (selectedBboxRef.current.objectType === 'completed_bbox' && selectedBboxRef.current.objectIndex !== undefined) {
                const bboxIndex = selectedBboxRef.current.objectIndex;
                if (bboxes[bboxIndex]) {
                  bboxes[bboxIndex] = { ...bboxes[bboxIndex], bbox: newBbox };
                  next[currentFrame] = { ...next[currentFrame], bboxes: bboxes };
                }
              } else if (selectedBboxRef.current.objectType === 'working_bbox' && ann.bbox) {
                // Update current working bbox
                next[currentFrame] = { 
                  ...ann, 
                  bbox: newBbox,
                  bboxId: selectedBboxRef.current.bboxId
                };
              }
            } else {
              // Single animal mode: update current bbox
              const [origX, origY, origW, origH] = bboxOriginal.current;
              const newBbox = [origX + dx, origY + dy, origW, origH];
              next[currentFrame] = { ...next[currentFrame], bbox: newBbox };
            }
          }
          
          return next;
        });
      } else if (!multiAnimalMode && multiKeypointDragStart.current && hasMoved.current && !selectedBbox && !selectedSkeleton) {
        // Start dragging multiple keypoints when movement is detected
        // CRITICAL: Only use OLD system in single-animal mode
        if (!draggingMultipleKeypoints.current) {
          draggingMultipleKeypoints.current = true;
          canvas.style.cursor = 'grabbing';
          // Save to undo stack BEFORE starting multi-keypoint drag operation
          saveToUndoStack && saveToUndoStack();
        }
        
        // Calculate offset from start position
        const dx = imagePos.x - multiKeypointDragStart.current.x;
        const dy = imagePos.y - multiKeypointDragStart.current.y;
        
        // Drag all selected keypoints together
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          // Update keypoints using objKey approach - CRITICAL: This OLD system logic should ONLY run in single-animal mode
          if (multiKeypointOriginalPositions.current && multiKeypointOriginalPositions.current instanceof Map) {
            // Single animal mode: update current keypoints
            const kp = (ann.keypoints || Array(keypointLabels.length).fill(null)).slice();
            
            selectedKeypoints.current.forEach(objKey => {
              const orig = multiKeypointOriginalPositions.current.get(objKey);
              if (!orig) return;
              const info = getObjKeyInfo(objKey, ann, currentSkeletonId);
              kp[info.kpIdx] = { x: orig.x + dx, y: orig.y + dy };
            });
        
            next[currentFrame] = { 
              ...ann, 
              keypoints: kp, 
              visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice() 
            };
          }
          
          return next;
        });
      } else if (selectedKeypoint.current !== null && hasMoved.current) {
        // Start dragging single keypoint when movement is detected
        if (!dragActive.current) {
          dragActive.current = true;
          canvas.style.cursor = 'grabbing';
          // NOTE: Undo stack already saved at mouse down when keypoint was selected
        }
        
        // Drag keypoint - update position continuously but don't save to undo stack yet
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          // If selection vanished, bail out safely
          if (!selectedKeypoint.current) return prev;
          
          const kp = (ann.keypoints || Array(keypointLabels.length).fill(null)).slice();
          kp[selectedKeypoint.current.idx] = { x: imagePos.x, y: imagePos.y };
          
          if (multiAnimalMode) {
            // Multi-animal mode: update in the appropriate skeleton
            const skeletons = ann.skeletons ? [...ann.skeletons] : [];
            let workingKeypoints = ann.keypoints ? [...ann.keypoints] : null;
            const newPos = { x: imagePos.x, y: imagePos.y };
            
            // Use the specific object information from selectedKeypoint to target the exact skeleton
            if (selectedKeypoint.current.objectType === 'completed_skeleton' && selectedKeypoint.current.objectIndex !== undefined) {
              // Update specific completed skeleton using its array index (not ID search)
              const skeletonIndex = selectedKeypoint.current.objectIndex;
              if (skeletons[skeletonIndex]) {
                if (!skeletons[skeletonIndex].keypoints) skeletons[skeletonIndex].keypoints = [];
                skeletons[skeletonIndex].keypoints[selectedKeypoint.current.idx] = newPos;
                next[currentFrame] = { ...ann, skeletons: skeletons };
              }
            } else if (selectedKeypoint.current.objectType === 'working_skeleton' && workingKeypoints) {
              // Update current working skeleton
              workingKeypoints[selectedKeypoint.current.idx] = newPos;
              next[currentFrame] = { ...ann, keypoints: workingKeypoints };
            }
          } else {
            // Single animal mode: update current keypoints
          const kp = (ann.keypoints || Array(keypointLabels.length).fill(null)).slice();
            if (selectedKeypoint.current) {
              kp[selectedKeypoint.current.idx] = { x: imagePos.x, y: imagePos.y };
            }
          next[currentFrame] = { 
            ...ann, 
            keypoints: kp, 
            visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice() 
          };
          }
          
          return next;
        });
      } else if (resizingBbox.current && resizeHandle.current) {
        // Resize bbox
        const dx = imagePos.x - bboxDragStart.current.x;
        const dy = imagePos.y - bboxDragStart.current.y;
        const [origX, origY, origW, origH] = resizeStartBbox.current;
        
        let newX = origX, newY = origY, newW = origW, newH = origH;
        
        switch (resizeHandle.current) {
          case 'nw':
            newX = origX + dx;
            newY = origY + dy;
            newW = origW - dx;
            newH = origH - dy;
            break;
          case 'ne':
            newY = origY + dy;
            newW = origW + dx;
            newH = origH - dy;
            break;
          case 'sw':
            newX = origX + dx;
            newW = origW - dx;
            newH = origH + dy;
            break;
          case 'se':
            newW = origW + dx;
            newH = origH + dy;
            break;
          case 'n':
            newY = origY + dy;
            newH = origH - dy;
            break;
          case 's':
            newH = origH + dy;
            break;
          case 'w':
            newX = origX + dx;
            newW = origW - dx;
            break;
          case 'e':
            newW = origW + dx;
            break;
        }
        
        // Ensure minimum size
        const minSize = 10;
        if (newW < minSize) {
          if (resizeHandle.current.includes('w')) newX = origX + origW - minSize;
          newW = minSize;
        }
        if (newH < minSize) {
          if (resizeHandle.current.includes('n')) newY = origY + origH - minSize;
          newH = minSize;
        }
        
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          if (multiAnimalMode) {
            // Multi-animal mode: update specific bbox using resize bbox info
            if (!resizeBboxInfo.current) {
              return next; // Exit early if reference is null
            }
            
            const bboxes = ann.bboxes ? [...ann.bboxes] : [];
            
            // Use the objectIndex from resizeBboxInfo instead of searching by ID
            if (resizeBboxInfo.current.objectType === 'completed_bbox' && resizeBboxInfo.current.objectIndex !== undefined) {
              // Update specific bbox using its array index
              const bboxIndex = resizeBboxInfo.current.objectIndex;
              if (bboxes[bboxIndex]) {
                bboxes[bboxIndex] = { ...bboxes[bboxIndex], bbox: [newX, newY, newW, newH] };
                next[currentFrame] = { 
                  ...ann, 
                  bboxes: bboxes,
                  // Preserve existing skeletons and keypoints
                  skeletons: ann.skeletons ? [...ann.skeletons] : [],
                  keypoints: ann.keypoints ? [...ann.keypoints] : null,
                  visibilities: ann.visibilities ? [...ann.visibilities] : null,
                  skeletonId: ann.skeletonId
                };
              }
            } else if (resizeBboxInfo.current.objectType === 'working_bbox' && ann.bbox) {
              // Update current working bbox
              next[currentFrame] = { 
                ...ann, 
                bbox: [newX, newY, newW, newH],
                bboxId: resizeBboxInfo.current.bboxId,
                // Preserve existing skeletons and keypoints
                skeletons: ann.skeletons ? [...ann.skeletons] : [],
                keypoints: ann.keypoints ? [...ann.keypoints] : null,
                visibilities: ann.visibilities ? [...ann.visibilities] : null,
                skeletonId: ann.skeletonId
              };
            }
          } else {
            // Single animal mode: update current bbox
            next[currentFrame] = { 
              ...ann, 
              bbox: [newX, newY, newW, newH],
              keypoints: (ann.keypoints || Array(keypointLabels.length).fill(null)).slice(),
              visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice()
            };
          }
          return next;
        });
      } else if (skeletonDragStart.current && hasMoved.current && !draggingMultipleObjects.current) {
        if (!draggingSkeleton.current) {
          draggingSkeleton.current = true;
          canvas.style.cursor = 'grabbing';
          // Save to undo stack BEFORE starting skeleton drag operation
          saveToUndoStack && saveToUndoStack();
        }
        
        // Drag entire skeleton
        const dx = imagePos.x - skeletonDragStart.current.x;
        const dy = imagePos.y - skeletonDragStart.current.y;
        
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          // Safety check: ensure skeletonOriginalPositions.current exists and is an array
          if (!skeletonOriginalPositions.current || !Array.isArray(skeletonOriginalPositions.current)) {
            return prev; // Return unchanged if no valid original positions
          }
          
          // Update skeleton keypoints
          const newKeypoints = skeletonOriginalPositions.current.map(originalPt => 
            originalPt ? { x: originalPt.x + dx, y: originalPt.y + dy } : null
          );
          
          // Update any selected keypoints from other skeletons
          if (selectedKeypoints.current.size > 0 && multiKeypointOriginalPositions.current) {
            selectedKeypoints.current.forEach(objKey => {
              const orig = multiKeypointOriginalPositions.current.get(objKey);
              if (!orig) return;
              const info = getObjKeyInfo(objKey, ann, currentSkeletonId);
              if (info.skeletonId !== currentSkeletonId) { // Only update keypoints from other skeletons
                if (multiAnimalMode) {
                  const skeletons = ann.skeletons || [];
                  if (skeletons[info.skeletonId] && skeletons[info.skeletonId].keypoints) {
                    skeletons[info.skeletonId].keypoints[info.kpIdx] = { x: orig.x + dx, y: orig.y + dy };
                  }
                } else {
                  newKeypoints[info.kpIdx] = { x: orig.x + dx, y: orig.y + dy };
                }
              }
            });
          }
          
          if (multiAnimalMode && draggingSkeletonInfo.current) {
            const info = draggingSkeletonInfo.current;
            const skeletons = ann.skeletons ? [...ann.skeletons] : [];
            let workingKeypoints = ann.keypoints ? [...ann.keypoints] : null;
            
            // Check if we have multiple objects selected (more than just this skeleton)
            const hasMultipleSelections = selectedObjectsMA.current.size > 1;
            
                          if (hasMultipleSelections) {
                // Store original positions at drag start if not already stored
                if (!multiSkeletonOriginalPositions.current) {
                  multiSkeletonOriginalPositions.current = new Map();
                  
                  // First identify which skeletons are fully selected
                  const fullySelectedSkeletons = new Set();
                  
                  // Check completed skeletons
                  skeletons.forEach((_, skeletonIndex) => {
                    if (selectedObjectsMA.current.has(`completed_skeleton_${skeletonIndex}`)) {
                      fullySelectedSkeletons.add(`completed_skeleton_${skeletonIndex}`);
                    }
                  });
                  
                  // Check working skeleton
                  if (selectedObjectsMA.current.has('working_skeleton')) {
                    fullySelectedSkeletons.add('working_skeleton');
                  }

                  // Store positions for fully selected skeletons
                  fullySelectedSkeletons.forEach(objKey => {
                    if (objKey.startsWith('completed_skeleton_')) {
                      const skeletonIndex = parseInt(objKey.split('_')[2]);
                      if (skeletons[skeletonIndex]) {
                        multiSkeletonOriginalPositions.current.set(objKey, 
                          skeletons[skeletonIndex].keypoints.map(pt => pt ? { ...pt } : null)
                        );
                      }
                    } else if (objKey === 'working_skeleton' && workingKeypoints) {
                      multiSkeletonOriginalPositions.current.set(objKey,
                        workingKeypoints.map(pt => pt ? { ...pt } : null)
                      );
                    }
                  });

                  // Then store individual keypoint positions for non-fully selected skeletons
                  selectedObjectsMA.current.forEach(objKey => {
                    if (objKey.startsWith('keypoint_') || objKey.startsWith('completed_skeleton_') && objKey.split('_').length > 3) {
                      const [_, type, skeletonId, keypointIdx] = objKey.split('_');
                      const skeletonIndex = parseInt(skeletonId);
                      const kpIndex = parseInt(keypointIdx);
                      
                      // Only store if the skeleton is not fully selected
                      if (!fullySelectedSkeletons.has(`completed_skeleton_${skeletonIndex}`)) {
                        if (skeletons[skeletonIndex] && skeletons[skeletonIndex].keypoints[kpIndex]) {
                          multiSkeletonOriginalPositions.current.set(objKey, {
                            point: { ...skeletons[skeletonIndex].keypoints[kpIndex] },
                            skeletonIndex,
                            keypointIndex: kpIndex
                          });
                        }
                      }
                    } else if (objKey.startsWith('working_keypoint_') || (objKey.startsWith('working_skeleton_') && objKey !== 'working_skeleton')) {
                      // Only store if working skeleton is not fully selected
                      if (!fullySelectedSkeletons.has('working_skeleton')) {
                        const kpIndex = parseInt(objKey.split('_')[2]);
                        if (workingKeypoints && workingKeypoints[kpIndex]) {
                          multiSkeletonOriginalPositions.current.set(objKey, {
                            point: { ...workingKeypoints[kpIndex] },
                            isWorking: true,
                            keypointIndex: kpIndex
                          });
                        }
                      }
                    }
                  });
                }
                
                // Create a copy of skeletons to modify
                const updatedSkeletons = [...skeletons];
                let updatedWorkingKeypoints = workingKeypoints ? [...workingKeypoints] : null;

                // First handle whole skeleton movements
                selectedObjectsMA.current.forEach(objKey => {
                  if (objKey === 'working_skeleton' || (objKey.startsWith('completed_skeleton_') && !objKey.includes('_', objKey.lastIndexOf('_') + 1))) {
                    const originalData = multiSkeletonOriginalPositions.current.get(objKey);
                    if (!originalData || !Array.isArray(originalData)) return;

                    if (objKey === 'working_skeleton' && updatedWorkingKeypoints) {
                      // Handle whole working skeleton movement
                      updatedWorkingKeypoints = originalData.map(pt => pt ? { x: pt.x + dx, y: pt.y + dy } : null);
                    } else {
                      // Handle whole completed skeleton movement
                      const skeletonIndex = parseInt(objKey.split('_')[2]);
                      if (updatedSkeletons[skeletonIndex]) {
                        const existingSkeleton = updatedSkeletons[skeletonIndex];
                        updatedSkeletons[skeletonIndex] = {
                          ...existingSkeleton,
                          keypoints: originalData.map(pt => pt ? { x: pt.x + dx, y: pt.y + dy } : null),
                          visibilities: existingSkeleton.visibilities
                        };
                      }
                    }
                  }
                });

                // Then handle individual keypoint movements
                selectedObjectsMA.current.forEach(objKey => {
                  // Skip whole skeleton keys as they were handled above
                  if (objKey === 'working_skeleton' || (objKey.startsWith('completed_skeleton_') && !objKey.includes('_', objKey.lastIndexOf('_') + 1))) {
                    return;
                  }

                  const originalData = multiSkeletonOriginalPositions.current.get(objKey);
                  if (!originalData || !originalData.point) return;

                  if ((objKey.startsWith('keypoint_') || objKey.startsWith('completed_skeleton_')) && objKey.split('_').length > 3) {
                    // Handle individual completed skeleton keypoint movement
                    const { point, skeletonIndex, keypointIndex } = originalData;
                    if (updatedSkeletons[skeletonIndex] && updatedSkeletons[skeletonIndex].keypoints[keypointIndex]) {
                      const updatedKeypoints = [...updatedSkeletons[skeletonIndex].keypoints];
                      updatedKeypoints[keypointIndex] = { x: point.x + dx, y: point.y + dy };
                      updatedSkeletons[skeletonIndex] = {
                        ...updatedSkeletons[skeletonIndex],
                        keypoints: updatedKeypoints
                      };
                    }
                  } else if (objKey.startsWith('working_keypoint_') || (objKey.startsWith('working_skeleton_') && objKey !== 'working_skeleton')) {
                    // Handle individual working keypoint movement
                    const { point, keypointIndex } = originalData;
                    if (updatedWorkingKeypoints && updatedWorkingKeypoints[keypointIndex]) {
                      const updatedKeypoints = [...updatedWorkingKeypoints];
                      updatedKeypoints[keypointIndex] = { x: point.x + dx, y: point.y + dy };
                      updatedWorkingKeypoints = updatedKeypoints;
                    }
                  }
                });
                
                next[currentFrame] = {
                  ...ann,
                  skeletons: updatedSkeletons,
                  keypoints: updatedWorkingKeypoints,
                  visibilities: updatedWorkingKeypoints ? (ann.visibilities || Array(keypointLabels.length).fill(2)).slice() : ann.visibilities
                };
            } else {
              // Single skeleton drag - original behavior
              if (info.type === 'completed_skeleton' && info.skeletonIndex !== null) {
                if (skeletons[info.skeletonIndex]) {
                  const existingSkeleton = skeletons[info.skeletonIndex];
                  skeletons[info.skeletonIndex] = { 
                    ...existingSkeleton,
                    keypoints: newKeypoints,
                    visibilities: existingSkeleton.visibilities
                  };
                  next[currentFrame] = { ...ann, skeletons };
                }
              } else {
                // working skeleton - update working skeleton data only
                next[currentFrame] = { 
                  ...ann, 
                  keypoints: newKeypoints,
                  visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice()
                };
              }
            }
          } else {
            // Single-animal mode
            next[currentFrame] = { 
              ...ann, 
              keypoints: newKeypoints,
              visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice()
            };
          }
          
          return next;
        });
      } else if (dragSelectStart.current && hasMoved.current && !selectedKeypoint.current && !multiKeypointDragStart.current && !bboxDragActive.current && !resizingBbox.current && !draggingSkeleton.current && !draggingMultipleObjects.current) {
        // Start drag selection when movement is detected on empty space
        if (!dragSelecting.current) {
          dragSelecting.current = true;
          dragSelectRect.current = { x: canvasPos.x, y: canvasPos.y, w: 0, h: 0 };

          
          // Clear selections for non-Ctrl drag
          if (!dragSelectCtrl.current) {
            setSelectedBbox(false);
            selectedKeypoints.current.clear();
          }
        }
        
        // Update drag selection rectangle
        const sx = dragSelectStart.current.x;
        const sy = dragSelectStart.current.y;
        dragSelectRect.current = {
          x: Math.min(sx, canvasPos.x),
          y: Math.min(sy, canvasPos.y),
          w: Math.abs(canvasPos.x - sx),
          h: Math.abs(canvasPos.y - sy)
        };
        draw();
      } else if (bboxDragStart.current && selectedBboxRef.current && hasMoved.current && !draggingMultiObjectsMA.current) {
        // Start/continue bbox dragging when movement is detected (only if not doing multi-object drag)
        if (!bboxDragActive.current) {
          bboxDragActive.current = true;
          canvas.style.cursor = 'grabbing';
          // Save to undo stack BEFORE starting bbox drag operation
          saveToUndoStack && saveToUndoStack();
        }
        
        // Drag bbox
        const dx = imagePos.x - bboxDragStart.current.x;
        const dy = imagePos.y - bboxDragStart.current.y;
        const [origX, origY, origW, origH] = bboxOriginal.current;
        const newBbox = [origX + dx, origY + dy, origW, origH];
        
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          if (multiAnimalMode) {
            // Multi-animal mode: update specific bbox in bboxes array
            // Add defensive check for selectedBboxRef.current
            if (!selectedBboxRef.current) {
              return next; // Exit early if reference is null
            }
            
            const bboxes = ann.bboxes ? [...ann.bboxes] : [];
            
            // Use the objectIndex from selectedBboxRef instead of searching by ID
            if (selectedBboxRef.current.objectType === 'completed_bbox' && selectedBboxRef.current.objectIndex !== undefined) {
              // Update specific bbox using its array index
              const bboxIndex = selectedBboxRef.current.objectIndex;
              if (bboxes[bboxIndex]) {
                bboxes[bboxIndex] = { ...bboxes[bboxIndex], bbox: newBbox };
                next[currentFrame] = { ...ann, bboxes: bboxes };
              }
            } else if (selectedBboxRef.current.objectType === 'working_bbox' && ann.bbox) {
              // Update current working bbox
              next[currentFrame] = { 
                ...ann, 
                bbox: newBbox,
                bboxId: selectedBboxRef.current.bboxId
              };
            }
          } else {
            // Single animal mode: update current bbox
            next[currentFrame] = { 
              ...ann, 
              bbox: newBbox,
              keypoints: (ann.keypoints || Array(keypointLabels.length).fill(null)).slice(),
              visibilities: (ann.visibilities || Array(keypointLabels.length).fill(2)).slice()
            };
          }
          
          return next;
        });
      }
    };

    // Mouse up
    const handleMouseUp = (e) => {
      e.preventDefault(); // Prevent browser default behavior
      // Prevent duplicate handling
      if (mouseUpHandled.current) return;
      mouseUpHandled.current = true;
      
      // Reset movement tracking at the end
      const wasMoving = hasMoved.current;
      

      
      if (panning.current) {
        panning.current = false;
        canvas.style.cursor = spacePressed.current ? 'grab' : 
                            mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
              } else if (mode === 'bbox' && drawing.current) {
        // Finish drawing box
        drawing.current = false;
        const { x, y, w, h } = currentBox.current;
        
        setAnnotations(prev => {
          const next = [...prev];
          const existingAnn = next[currentFrame] || {};
          
          if (multiAnimalMode) {
            // Multi-animal mode: add directly to bboxes array
            const bboxes = existingAnn.bboxes || [];
            const newBbox = {
              bbox: [x, y, w, h],
              id: existingAnn.bboxId !== undefined ? existingAnn.bboxId : currentBboxId
            };
            
            // Check if a bbox with this ID already exists
            const existingIndex = bboxes.findIndex(b => b.id === newBbox.id);
            if (existingIndex !== -1) {
              // Replace existing bbox
              bboxes[existingIndex] = newBbox;
            } else {
              // Add new bbox
              bboxes.push(newBbox);
            }
            
            // Clear current working bbox and prepare for next one
            next[currentFrame] = {
              ...existingAnn,
              bboxes: bboxes,
              bbox: null,
              bboxId: undefined
            };
            
            // Increment bbox ID for next bbox
            setCurrentBboxId && setCurrentBboxId(currentBboxId + 1);
          } else {
            // Single animal mode: use current bbox field
          next[currentFrame] = { 
            ...existingAnn, 
            bbox: [x, y, w, h],
            bboxId: currentBboxId !== undefined ? currentBboxId : (existingAnn.bboxId !== undefined ? existingAnn.bboxId : 0)
          };
          }
          
          return next;
        });
        
        currentBox.current = null;
        setMode && setMode(null);
        // Save to undo stack after bbox creation
        setTimeout(() => saveToUndoStack && saveToUndoStack(), 0);
        draw();
      } else if (dragActive.current) {
        // Finish dragging keypoint
        dragActive.current = false;
        selectedKeypoint.current = null;
        dragStartPos.current = null;
        justFinishedKeypointDrag.current = true;
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Restore original keypoint selection states
          originalKeypointSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedObjectsMA.current.add(objKey);
              selectedKeypoints.current.add(objKey);
            } else {
              // Remove it from selections
              selectedObjectsMA.current.delete(objKey);
              selectedKeypoints.current.delete(objKey);
            }
          });
          
          // Clear the tracking
          originalKeypointSelections.current.clear();
          // Sync selection to sidebar  
          syncSelectionToSidebar();
        } else {
          // SINGLE ANIMAL MODE: Restore original keypoint selection states
          originalKeypointSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedKeypoints.current.add(objKey);
            } else {
              // Remove it from selections
              selectedKeypoints.current.delete(objKey);
            }
          });
          
          // Clear the tracking
          originalKeypointSelections.current.clear();
        }
        
        // Also clear hover state to ensure visual highlighting is removed
        hoveredKeypoint.current = null;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Draw with updated selections
        draw();
      } else if (!multiAnimalMode && draggingMultipleObjects.current) {
        // Finish dragging multiple objects - maintain selections (multiple object behavior)
        // CRITICAL: Only use OLD system in single-animal mode
        draggingMultipleObjects.current = false;
        multiKeypointDragStart.current = null;
        multiKeypointOriginalPositions.current = null;
        bboxDragStart.current = null;
        bboxOriginal.current = null;
        justFinishedMultiDrag.current = true;
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Restore original selection states for involved objects
          originalKeypointSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (objKey.includes('keypoint') || (objKey.includes('skeleton_') && objKey.split('_').length > 3)) {
              if (wasOriginallySelected) {
                // Keep it selected
                selectedObjectsMA.current.add(objKey);
                selectedKeypoints.current.add(objKey);
              } else {
                // Remove it from selections
                selectedObjectsMA.current.delete(objKey);
                selectedKeypoints.current.delete(objKey);
              }
            }
          });
          
          originalSkeletonSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedObjectsMA.current.add(objKey);
              setSelectedSkeleton(true); // Keep legacy state for drawing compatibility
            } else {
              // Remove it from selections
              selectedObjectsMA.current.delete(objKey);
              // Only clear legacy state if no skeletons are selected
              if (!Array.from(selectedObjectsMA.current).some(key => key.includes('skeleton'))) {
                setSelectedSkeleton(false);
              }
            }
          });
          
                     originalBboxSelections.current.forEach((wasOriginallySelected, objKey) => {
             if (wasOriginallySelected) {
               // Keep it selected
               selectedObjectsMA.current.add(objKey);
               setSelectedBbox(true);
             } else {
               // Remove it from selections
               selectedObjectsMA.current.delete(objKey);
               // Only clear legacy state if no bboxes are selected
               if (!Array.from(selectedObjectsMA.current).some(key => key.includes('bbox'))) {
                 setSelectedBbox(false);
               }
             }
           });
           
           // Clear the tracking
           originalKeypointSelections.current.clear();
           originalSkeletonSelections.current.clear();
           originalBboxSelections.current.clear();
         } else {
           // SINGLE ANIMAL MODE: Keep all selections after multi-object drag (don't clear them)
         }
        
        // Only clear hover states to ensure visual highlighting is removed
        hoveredKeypoint.current = null;
        hoveredBbox.current = false;
        hoveredSkeleton.current = false;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Draw without overrides (use current selections)
        draw();
      } else if (draggingMultiObjectsMA.current) {
        // MULTI-ANIMAL MODE: Finish dragging multiple objects
        draggingMultiObjectsMA.current = false;
        multiObjectDragStartMA.current = null;
        multiObjectOriginalPositionsMA.current.clear();
        justFinishedMultiDrag.current = true;
        
        // Restore original keypoint selection states for keypoints only
        originalKeypointSelections.current.forEach((wasOriginallySelected, objKey) => {
          if (objKey.includes('keypoint') || (objKey.includes('skeleton_') && objKey.split('_').length > 3)) {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedObjectsMA.current.add(objKey);
              selectedKeypoints.current.add(objKey);
            } else {
              // Remove it from selections
              selectedObjectsMA.current.delete(objKey);
              selectedKeypoints.current.delete(objKey);
            }
          }
        });
        
        // Restore original skeleton selection states
        originalSkeletonSelections.current.forEach((wasOriginallySelected, objKey) => {
          if (wasOriginallySelected) {
            // Keep it selected
            selectedObjectsMA.current.add(objKey);
            setSelectedSkeleton(true); // Keep legacy state for drawing compatibility
          } else {
            // Remove it from selections
            selectedObjectsMA.current.delete(objKey);
            // Only clear legacy state if no skeletons are selected
            if (!Array.from(selectedObjectsMA.current).some(key => key.includes('skeleton'))) {
              setSelectedSkeleton(false);
            }
          }
        });
        
        // Restore original bbox selection states
        originalBboxSelections.current.forEach((wasOriginallySelected, objKey) => {
          if (wasOriginallySelected) {
            // Keep it selected
            selectedObjectsMA.current.add(objKey);
            setSelectedBbox(true);
          } else {
            // Remove it from selections
            selectedObjectsMA.current.delete(objKey);
            // Only clear legacy state if no bboxes are selected
            if (!Array.from(selectedObjectsMA.current).some(key => key.includes('bbox'))) {
              setSelectedBbox(false);
            }
          }
        });
        
        // Clear the tracking
        originalKeypointSelections.current.clear();
        originalSkeletonSelections.current.clear();
        originalBboxSelections.current.clear();
        
        // Only clear hover states to ensure visual highlighting is removed
        hoveredObjectMA.current = null;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Draw without overrides (use current selections)
        draw();
        // Sync selection to sidebar  
        syncSelectionToSidebar();
      } else if (!multiAnimalMode && draggingMultipleKeypoints.current) {
        // Finish dragging multiple keypoints - maintain selections (multiple object behavior)
        // CRITICAL: Only use OLD system in single-animal mode
        draggingMultipleKeypoints.current = false;
        multiKeypointDragStart.current = null;
        multiKeypointOriginalPositions.current = null;
        justFinishedMultiDrag.current = true;
        
        // Keep keypoint selections after multi-keypoint drag (don't clear them)
        // Only clear hover state to ensure visual highlighting is removed
        hoveredKeypoint.current = null;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Draw without overrides (use current selections)
        draw();
      } else if (selectedKeypoint.current !== null && !hasMoved.current) {
        // This was a click on a keypoint without dragging - keep as selection for click handler
        // Don't clear selectedKeypoint.current here - let the click handler deal with it
        // But clean up any tracking that was set up for drag
        originalKeypointSelections.current.clear();
      } else if (multiKeypointDragStart.current && !hasMoved.current) {
        // Clean up multi-keypoint/object selection that didn't result in dragging
        multiKeypointDragStart.current = null;
        multiKeypointOriginalPositions.current = null;
        originalKeypointSelections.current.clear(); // Clean up keypoint selection tracking
        originalSkeletonSelections.current.clear(); // Clean up skeleton selection tracking
        originalBboxSelections.current.clear(); // Clean up bbox selection tracking
        if (bboxDragStart.current) {
          bboxDragStart.current = null;
          bboxOriginal.current = null;
        }
      } else if (bboxDragActive.current) {
        // Finish dragging bbox
        bboxDragActive.current = false;
        bboxDragStart.current = null;
        bboxOriginal.current = null;
        justFinishedBboxDrag.current = true;
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Restore original bbox selection states
          originalBboxSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedObjectsMA.current.add(objKey);
              setSelectedBbox(true);
            } else {
              // Remove it from selections
              selectedObjectsMA.current.delete(objKey);
              // Only clear legacy state if no bboxes are selected
              if (!Array.from(selectedObjectsMA.current).some(key => key.includes('bbox'))) {
                setSelectedBbox(false);
              }
            }
          });
          
          // Clear the tracking
          originalBboxSelections.current.clear();
          draw();
          // Sync selection to sidebar  
          syncSelectionToSidebar();
        } else {
          // SINGLE ANIMAL MODE: Restore original selection state
          const wasOriginallySelected = originalBboxSelected.current;
          originalBboxSelected.current = false; // Reset for next operation
          
          // Force the draw override and update state
          forceDrawBboxSelection.current = wasOriginallySelected;
          setSelectedBbox(wasOriginallySelected);
          
          // Draw immediately with forced override
          draw();
          
          // Clear the override after a short delay
          setTimeout(() => {
            forceDrawBboxSelection.current = null;
          }, 100);
        }
        
        // Clear selectedBboxRef after drag completion
        selectedBboxRef.current = null;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
      } else if (resizingBbox.current) {
        // Finish resizing bbox
        resizingBbox.current = false;
        resizeHandle.current = null;
        bboxDragStart.current = null;
        resizeStartBbox.current = null;
        resizeBboxInfo.current = null; // Clean up resize bbox info
        justFinishedBboxResize.current = true;
        
        // In single animal mode, restore original selection state
        if (!multiAnimalMode) {
          const wasOriginallySelected = originalBboxSelected.current;
          originalBboxSelected.current = false; // Reset for next operation
          
          // Force the draw override and update state
          forceDrawBboxSelection.current = wasOriginallySelected;
          setSelectedBbox(wasOriginallySelected);
          
          // Draw immediately with forced override
          draw();
          
          // Clear the override after a short delay
          setTimeout(() => {
            forceDrawBboxSelection.current = null;
          }, 100);
        }
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
      } else if (draggingSkeleton.current) {
        // Finish dragging skeleton
        draggingSkeleton.current = false;
        skeletonDragStart.current = null;
        skeletonOriginalPositions.current = null;
        multiSkeletonOriginalPositions.current = null;
        justFinishedSkeletonDrag.current = true;
        
        if (multiAnimalMode) {
          // MULTI-ANIMAL MODE: Restore original skeleton selection states
          originalSkeletonSelections.current.forEach((wasOriginallySelected, objKey) => {
            if (wasOriginallySelected) {
              // Keep it selected
              selectedObjectsMA.current.add(objKey);
              setSelectedSkeleton(true); // Keep legacy state for drawing compatibility
            } else {
              // Remove it from selections
              selectedObjectsMA.current.delete(objKey);
              // Only clear legacy state if no skeletons are selected
              if (!Array.from(selectedObjectsMA.current).some(key => key.includes('skeleton'))) {
                setSelectedSkeleton(false);
              }
            }
          });
          
          // Clear the tracking
          originalSkeletonSelections.current.clear();
          // Sync selection to sidebar  
          syncSelectionToSidebar();
         } else {
           // SINGLE ANIMAL MODE: Restore original skeleton selection state
           originalSkeletonSelections.current.forEach((wasOriginallySelected, objKey) => {
             if (wasOriginallySelected) {
               // Keep it selected
               setSelectedSkeleton(true);
             } else {
               // Remove it from selections
               setSelectedSkeleton(false);
             }
           });
           
           // Clear the tracking
           originalSkeletonSelections.current.clear();
         }
        
        // Also clear hover state to ensure visual highlighting is removed
        hoveredSkeleton.current = false;
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Draw with updated selections
        draw();
      } else if (dragSelecting.current) {
        // Finish drag selection
        const selectionResult = getObjectsInSelection(dragSelectRect.current);
        
        let finalBboxSelection = selectedBbox;
        let finalSkeletonSelection = selectedSkeleton;
        
        // Get current frame annotation
        const frameAnn = annotations[currentFrame] || {};
        let finalSelectedKeypoints = new Set(selectedKeypoints.current);
        
        if (!dragSelectCtrl.current) {
          // Replace mode: only newly selected keypoints
          finalSelectedKeypoints = new Set(selectionResult.keypoints);
        } else {
          // Add mode: union of existing and newly selected
          selectionResult.keypoints.forEach(objKey => finalSelectedKeypoints.add(objKey));
        }
        
        // Check if all keypoints are selected (need to check all skeletons in multi-animal mode)
        let allKeypointsSelected = false;
        if (multiAnimalMode) {
          // In multi-animal mode, only set allKeypointsSelected to true if entire skeletons are in selection result
          // This prevents automatically selecting skeletons when only individual keypoints are selected
          allKeypointsSelected = false; // Don't auto-select skeletons based on individual keypoints
        } else {
          // Single animal mode: check if current skeleton is fully selected
          allKeypointsSelected = frameAnn.keypoints && 
            frameAnn.keypoints.every((pt, idx) => {
              if (!pt) return true; // null keypoints don't need to be selected
              const skeletonId = frameAnn.skeletonId !== undefined ? frameAnn.skeletonId : 0;
              const objKey = `${skeletonId}_${idx}`;
              return finalSelectedKeypoints.has(objKey);
            });
        }
        
        if (!dragSelectCtrl.current) {
          // Replace current selection
          selectedKeypoints.current.clear();
          selectionResult.keypoints.forEach(objKey => selectedKeypoints.current.add(objKey));
          
          // Handle multi-animal selection
          if (multiAnimalMode) {
            // Clear and add all selected objects to multi-animal selection
            selectedObjectsMA.current.clear();
            selectionResult.keypoints.forEach(objKey => selectedObjectsMA.current.add(objKey));
            selectionResult.skeletons.forEach(objKey => selectedObjectsMA.current.add(objKey));
            selectionResult.bboxes.forEach(objKey => selectedObjectsMA.current.add(objKey));
            
            // FIXED: Also update selectedImageObjects for sidebar highlighting
            const newSelectedImageObjects = new Set();
            selectionResult.skeletons.forEach(objKey => newSelectedImageObjects.add(objKey));
            selectionResult.bboxes.forEach(objKey => newSelectedImageObjects.add(objKey));
            setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
            
            // When a skeleton is selected via drag, add all its keypoints to selectedKeypoints.current for full blue selection
            // BUT do NOT add them to selectedObjectsMA.current to avoid multi-object drag logic
            selectionResult.skeletons.forEach(skeletonObjKey => {
              if (skeletonObjKey.startsWith('completed_skeleton_')) {
                const skeletonIndex = parseInt(skeletonObjKey.split('_')[2]);
                const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
                if (skeleton && skeleton.keypoints) {
                  skeleton.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `completed_skeleton_${skeletonIndex}_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'drag'); // Mark as drag-selected (blue)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              } else if (skeletonObjKey === 'working_skeleton') {
                if (frameAnn.keypoints) {
                  frameAnn.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `working_skeleton_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'drag'); // Mark as drag-selected (blue)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              }
            });
          }
          
          // Handle bbox selection
          if (multiAnimalMode) {
            // Set the legacy bbox selection state if any bbox is selected
            const hasBboxSelection = selectionResult.bboxes.size > 0;
            setSelectedBbox(hasBboxSelection);
            finalBboxSelection = hasBboxSelection;
            
            // Store reference to the first selected bbox for dragging
            if (hasBboxSelection) {
              const firstBboxKey = Array.from(selectionResult.bboxes)[0];
              if (firstBboxKey === 'working_bbox') {
                selectedBboxRef.current = {
                  bboxId: frameAnn.bboxId !== undefined ? frameAnn.bboxId : currentBboxId,
                  bbox: frameAnn.bbox,
                  objKey: 'working_bbox',
                  objectType: 'working_bbox'
                };
              } else {
                // Extract bbox index from the key (completed_bbox_X)
                const bboxIndex = parseInt(firstBboxKey.split('_')[2]);
                const bboxObj = (frameAnn.bboxes || [])[bboxIndex];
                if (bboxObj) {
                  selectedBboxRef.current = {
                    bboxId: bboxObj.id,
                    bbox: bboxObj.bbox,
                    objKey: firstBboxKey,
                    objectType: 'completed_bbox',
                    objectIndex: bboxIndex
                  };
                }
              }
            } else {
              selectedBboxRef.current = null;
            }
          } else {
            // Single animal mode: original behavior
            const hasBboxSelection = selectionResult.bboxes.size > 0;
            setSelectedBbox(hasBboxSelection);
            finalBboxSelection = hasBboxSelection;
          }
          
          // Handle skeleton selection
          const hasSkeletonSelection = selectionResult.skeletons.size > 0;
          setSelectedSkeleton(hasSkeletonSelection || allKeypointsSelected);
          finalSkeletonSelection = hasSkeletonSelection || allKeypointsSelected;
        } else {
          // Add to current selection
          selectionResult.keypoints.forEach(objKey => selectedKeypoints.current.add(objKey));
          
          // Handle multi-animal selection (add to current)
          if (multiAnimalMode) {
            selectionResult.keypoints.forEach(objKey => selectedObjectsMA.current.add(objKey));
            selectionResult.skeletons.forEach(objKey => selectedObjectsMA.current.add(objKey));
            selectionResult.bboxes.forEach(objKey => selectedObjectsMA.current.add(objKey));
            
            // FIXED: Also update selectedImageObjects for sidebar highlighting (add to current)
            const newSelectedImageObjects = new Set(selectedImageObjects);
            selectionResult.skeletons.forEach(objKey => newSelectedImageObjects.add(objKey));
            selectionResult.bboxes.forEach(objKey => newSelectedImageObjects.add(objKey));
            setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
            
            // When a skeleton is added to selection via drag, also add all its keypoints to selectedKeypoints.current for full blue selection
            // BUT do NOT add them to selectedObjectsMA.current to avoid multi-object drag logic
            selectionResult.skeletons.forEach(skeletonObjKey => {
              if (skeletonObjKey.startsWith('completed_skeleton_')) {
                const skeletonIndex = parseInt(skeletonObjKey.split('_')[2]);
                const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
                if (skeleton && skeleton.keypoints) {
                  skeleton.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `completed_skeleton_${skeletonIndex}_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'drag'); // Mark as drag-selected (blue)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              } else if (skeletonObjKey === 'working_skeleton') {
                if (frameAnn.keypoints) {
                  frameAnn.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `working_skeleton_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'drag'); // Mark as drag-selected (blue)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              }
            });
          }
          
          // Handle bbox selection (add to current)
          if (selectionResult.bboxes.size > 0) {
            setSelectedBbox(true);
            finalBboxSelection = true;
            
            // Update bbox reference for the first selected bbox
            if (multiAnimalMode) {
              const firstBboxKey = Array.from(selectionResult.bboxes)[0];
              if (firstBboxKey === 'working_bbox') {
                selectedBboxRef.current = {
                  bboxId: frameAnn.bboxId !== undefined ? frameAnn.bboxId : currentBboxId,
                  bbox: frameAnn.bbox,
                  objKey: 'working_bbox',
                  objectType: 'working_bbox'
                };
              } else {
                // Extract bbox index from the key (completed_bbox_X)
                const bboxIndex = parseInt(firstBboxKey.split('_')[2]);
                const bboxObj = (frameAnn.bboxes || [])[bboxIndex];
                if (bboxObj) {
                  selectedBboxRef.current = {
                    bboxId: bboxObj.id,
                    bbox: bboxObj.bbox,
                    objKey: firstBboxKey,
                    objectType: 'completed_bbox',
                    objectIndex: bboxIndex
                  };
                }
              }
            }
          }
          
          // Handle skeleton selection (add to current)
          if (selectionResult.skeletons.size > 0 || allKeypointsSelected) {
            setSelectedSkeleton(true);
            finalSkeletonSelection = true;
          }
        }
        
        // Clean up drag selection state
        dragSelecting.current = false;
        dragSelectStart.current = null;
        dragSelectRect.current = null;
        dragSelectCtrl.current = false;
        justFinishedDragSelection.current = true;
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Force a redraw to clear the drag selection rectangle and update selections
        requestAnimationFrame(() => {
          draw({ 
            selectedBbox: finalBboxSelection, 
            selectedSkeleton: finalSkeletonSelection 
          });
        });
      } else if (dragSelectStart.current && !hasMoved.current) {
        // Clean up drag selection that didn't happen
        dragSelectStart.current = null;
        dragSelectCtrl.current = false;
      } else if (bboxDragActive.current) {
        // Finish dragging bbox - clear selection for consistency
        bboxDragActive.current = false;
        bboxDragStart.current = null;
        bboxOriginal.current = null;
        justFinishedBboxDrag.current = true;
        
        // Clear bbox selection after drag
        setSelectedBbox(false);
        
        // Also clear hover state to ensure visual highlighting is removed
        hoveredBbox.current = false;
        
        // Save to undo stack after bbox drag and then clear references
        setTimeout(() => {
          saveToUndoStack && saveToUndoStack();
          // Only clear selectedBboxRef after undo stack is updated
          selectedBboxRef.current = null;
        }, 0);
        
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
        
        // Immediately draw with cleared selection
        draw({ selectedBbox: false });
      } else if (bboxDragStart.current && !hasMoved.current) {
        // Clean up bbox drag preparation that didn't result in actual dragging (just a click)
        selectedBboxRef.current = null;
        bboxDragStart.current = null;
        bboxOriginal.current = null;
        originalBboxSelected.current = false; // Reset for next operation (single animal mode)
        originalBboxSelections.current.clear(); // Clean up bbox selection tracking (multi-animal mode)
        forceDrawBboxSelection.current = null; // Reset override
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
      } else if (skeletonDragStart.current && !hasMoved.current) {
        // Clean up skeleton drag preparation that didn't result in actual dragging (just a click)
        skeletonDragStart.current = null;
        skeletonOriginalPositions.current = null;
        draggingSkeletonInfo.current = null;
        originalSkeletonSelections.current.clear(); // Clean up skeleton selection tracking
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR :
                            mode === 'bbox' ? 'crosshair' : 'default';
      }
      
      // Reset movement tracking
      mouseDownPos.current = null;
      hasMoved.current = false;
      
      // Allow next mouseup to be handled
      setTimeout(() => {
        mouseUpHandled.current = false;
      }, 0);
    };

    // Check if point is within image bounds
    const isWithinImageBounds = (imgX, imgY) => {
      const { width: imgW, height: imgH } = getImageDims();
      return imgX >= 0 && imgX <= imgW && imgY >= 0 && imgY <= imgH;
    };

    // Click for keypoint placement and bbox selection
    const handleClick = (e) => {
      const canvasPos = getCanvasPos(e);
      const imagePos = mapToImageCoords(canvasPos.x, canvasPos.y);
      const ctrlPressed = e.ctrlKey || e.metaKey;
      const wasMoving = hasMoved.current;
      
      // Skip click handling if we just finished a drag operation
      if (justFinishedDragSelection.current || justFinishedKeypointDrag.current || justFinishedMultiDrag.current || justFinishedSkeletonDrag.current || justFinishedBboxDrag.current || justFinishedBboxResize.current) {
        // Reset the drag flags after a small delay
        setTimeout(() => {
          justFinishedDragSelection.current = false;
          justFinishedKeypointDrag.current = false;
          justFinishedMultiDrag.current = false;
          justFinishedSkeletonDrag.current = false;
          justFinishedBboxDrag.current = false;
          justFinishedBboxResize.current = false;
        }, 0);
        return;
      }
      
      // Skip if there was movement (this was a drag, not a click)
      if (wasMoving) {
        return;
      }
      
      const withinImageBounds = isWithinImageBounds(imagePos.x, imagePos.y);
      
      if (mode === 'keypoint' && !spacePressed.current) {
        // Keypoint placement mode - only allow placement within image bounds
        if (!withinImageBounds) {
          return;
        }
        
        // Clear selections
        clearAllSelections();
        
        const ann = annotations[currentFrame] || {};
        const kp = (ann.keypoints || Array(keypointLabels.length).fill(null)).slice();
        const vis = (ann.visibilities || Array(keypointLabels.length).fill(2)).slice();
        
        if (kp[keypointIndex]) return; // Already placed
        
        kp[keypointIndex] = { x: imagePos.x, y: imagePos.y };
        vis[keypointIndex] = 2;
        
        setAnnotations(prev => {
          const next = [...prev];
          const existingAnn = next[currentFrame] || {};
          
          // Assign skeleton ID when placing the first keypoint of a new skeleton
          // or keep existing ID if skeleton already has one
          let skeletonId = existingAnn.skeletonId;
          if (skeletonId === undefined) {
            // This is a new skeleton, assign the current skeleton ID
            skeletonId = currentSkeletonId !== undefined ? currentSkeletonId : 0;
          }
          
          next[currentFrame] = { 
            ...existingAnn, 
            keypoints: kp, 
            visibilities: vis,
            skeletonId: skeletonId
          };
          return next;
        });
        
        // Save to undo stack after keypoint placement
        setTimeout(() => saveToUndoStack && saveToUndoStack(), 0);
        
        if (keypointIndex < keypointLabels.length - 1) {
          setKeypointIndex(keypointIndex + 1);
        } else {
          // Skeleton completed
          if (multiAnimalMode) {
            // In multi-animal mode, save the completed skeleton and prepare for next one
            setAnnotations(prev => {
              const next = [...prev];
              const currentAnn = next[currentFrame] || {};
              
              // Move current skeleton to skeletons array with DEEP COPY to avoid reference issues
              const skeletons = currentAnn.skeletons ? [...currentAnn.skeletons] : [];
              const newSkeleton = {
                keypoints: currentAnn.keypoints ? currentAnn.keypoints.map(pt => pt ? { ...pt } : null) : null, // Deep copy
                visibilities: currentAnn.visibilities ? [...currentAnn.visibilities] : null, // Deep copy
                id: currentAnn.skeletonId !== undefined ? currentAnn.skeletonId : currentSkeletonId
              };
              
              // Check if a skeleton with this ID already exists
              const existingIndex = skeletons.findIndex(s => s.id === newSkeleton.id);
              if (existingIndex !== -1) {
                // Replace existing skeleton with deep copy
                skeletons[existingIndex] = newSkeleton;
              } else {
                // Add new skeleton
                skeletons.push(newSkeleton);
              }
              
              // Clear current skeleton and prepare for next
              next[currentFrame] = {
                ...currentAnn,
                skeletons: skeletons,
                keypoints: null,
                visibilities: null,
                skeletonId: undefined
              };
              
              // Increment skeleton ID for next skeleton
              setCurrentSkeletonId && setCurrentSkeletonId(currentSkeletonId + 1);
              
              return next;
            });
            
            setKeypointIndex(0);
            setMode && setMode(null);
          }
          setKeypointIndex(0);
          setMode && setMode(null);
        }
      } else if (!spacePressed.current) {
        // General interaction mode (selection and deselection)
        
        if (!withinImageBounds) {
          // Click outside image bounds but within canvas - clear selections unless Ctrl is pressed
          if (!ctrlPressed) {
            clearAllSelections();
          }
          return;
        }
        
        // Click is within image bounds - check for object interactions
        const keypointResult = findKeypoint(imagePos.x, imagePos.y);
        const skeletonResult = findSkeletonHover(imagePos.x, imagePos.y);
        const bboxResult = findBbox(imagePos.x, imagePos.y);
        
        if (keypointResult) {
          if (multiAnimalMode) {
            // MULTI-ANIMAL MODE: Enhanced keypoint selection
            const keypointObjKey = keypointResult.objKey;
            
            if (ctrlPressed) {
              // Ctrl+click for multi-selection
              if (isSelectedInMultiAnimal(keypointObjKey)) {
                removeFromMultiAnimalSelection(keypointObjKey);
                selectedKeypoints.current.delete(keypointObjKey);
              } else {
                addToMultiAnimalSelection(keypointObjKey);
                selectedKeypoints.current.add(keypointObjKey);
              }
              // Don't clear other selections on Ctrl+click
            } else {
              // Regular click - select only this keypoint, clear others
              selectedObjectsMA.current.clear();
              selectedKeypoints.current.clear();
              addToMultiAnimalSelection(keypointObjKey);
              selectedKeypoints.current.add(keypointObjKey);
              setSelectedBbox(false);
              setSelectedSkeleton(false);
            }
            draw();
            // Sync selection to sidebar
            syncSelectionToSidebar();
          } else {
            // SINGLE ANIMAL MODE: Original logic
            if (ctrlPressed) {
              // Keypoint Ctrl+click for multi-selection
              if (selectedKeypoints.current.has(keypointResult.objKey)) {
                selectedKeypoints.current.delete(keypointResult.objKey);
              } else {
                selectedKeypoints.current.add(keypointResult.objKey);
              }
              // Don't clear other selections on Ctrl+click
              draw();
            } else {
              // Regular keypoint click - select only this keypoint, clear others
              selectedKeypoints.current.clear();
              selectedKeypoints.current.add(keypointResult.objKey);
              setSelectedBbox(false);
              setSelectedSkeleton(false);
              draw();
            }
          }
        } else if (skeletonResult && areAllKeypointsPlaced(skeletonResult)) {
          /* -------- Enhanced skeleton selection logic -------- */
          if (multiAnimalMode) {
            const skeletonObjKey = skeletonResult.objKey; // e.g., completed_skeleton_0

            if (ctrlPressed) {
              // Toggle selection state for this skeleton
              if (selectedObjectsMA.current.has(skeletonObjKey)) {
                selectedObjectsMA.current.delete(skeletonObjKey);
                
                // FIXED: Update selectedImageObjects for sidebar highlighting (remove from current)
                const newSelectedImageObjects = new Set(selectedImageObjects);
                newSelectedImageObjects.delete(skeletonObjKey);
                setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
                
                // Remove keypoints of this skeleton from selection (highlighting only)
                if (skeletonObjKey.startsWith('completed_skeleton_')) {
                  const skeletonIndex = parseInt(skeletonObjKey.split('_')[2]);
                  const frameAnn = annotations[currentFrame] || {};
                  const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
                  if (skeleton && skeleton.keypoints) {
                    skeleton.keypoints.forEach((pt, idx) => {
                      if (pt) {
                        const keypointObjKey = `completed_skeleton_${skeletonIndex}_${idx}`;
                        selectedKeypoints.current.delete(keypointObjKey);
                        // No need to remove from selectedObjectsMA.current since we don't add them there
                      }
                    });
                  }
                } else if (skeletonObjKey === 'working_skeleton') {
                  const frameAnn = annotations[currentFrame] || {};
                  if (frameAnn.keypoints) {
                    frameAnn.keypoints.forEach((pt, idx) => {
                      if (pt) {
                        const keypointObjKey = `working_skeleton_${idx}`;
                        selectedKeypoints.current.delete(keypointObjKey);
                        // No need to remove from selectedObjectsMA.current since we don't add them there
                      }
                    });
                  }
                }
              } else {
                selectedObjectsMA.current.add(skeletonObjKey);
                
                // FIXED: Update selectedImageObjects for sidebar highlighting (add to current)
                const newSelectedImageObjects = new Set(selectedImageObjects);
                newSelectedImageObjects.add(skeletonObjKey);
                setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
                
                // Add keypoints of this skeleton to selection for highlighting only (glow, not blue)
                // DON'T add to selectedObjectsMA.current to avoid multi-object drag logic
                if (skeletonObjKey.startsWith('completed_skeleton_')) {
                  const skeletonIndex = parseInt(skeletonObjKey.split('_')[2]);
                  const frameAnn = annotations[currentFrame] || {};
                  const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
                  if (skeleton && skeleton.keypoints) {
                    skeleton.keypoints.forEach((pt, idx) => {
                      if (pt) {
                        const keypointObjKey = `completed_skeleton_${skeletonIndex}_${idx}`;
                        selectedKeypoints.current.add(keypointObjKey);
                        keypointSelectionType.current.set(keypointObjKey, 'click'); // Mark as click-selected (glow only)
                        // DON'T add to selectedObjectsMA.current - only for highlighting
                      }
                    });
                  }
                } else if (skeletonObjKey === 'working_skeleton') {
                  const frameAnn = annotations[currentFrame] || {};
                  if (frameAnn.keypoints) {
                    frameAnn.keypoints.forEach((pt, idx) => {
                      if (pt) {
                        const keypointObjKey = `working_skeleton_${idx}`;
                        selectedKeypoints.current.add(keypointObjKey);
                        keypointSelectionType.current.set(keypointObjKey, 'click'); // Mark as click-selected (glow only)
                        // DON'T add to selectedObjectsMA.current - only for highlighting
                      }
                    });
                  }
                }
              }
            } else {
              // Select this skeleton exclusively
              selectedObjectsMA.current.clear();
              selectedKeypoints.current.clear();
              selectedObjectsMA.current.add(skeletonObjKey);
              
              // FIXED: Update selectedImageObjects for sidebar highlighting
              setSelectedImageObjects && setSelectedImageObjects(new Set([skeletonObjKey]));
              
              // Add keypoints of this skeleton to selection for highlighting only (glow, not blue)
              // DON'T add to selectedObjectsMA.current to avoid multi-object drag logic
              if (skeletonObjKey.startsWith('completed_skeleton_')) {
                const skeletonIndex = parseInt(skeletonObjKey.split('_')[2]);
                const frameAnn = annotations[currentFrame] || {};
                const skeleton = (frameAnn.skeletons || [])[skeletonIndex];
                if (skeleton && skeleton.keypoints) {
                  skeleton.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `completed_skeleton_${skeletonIndex}_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'click'); // Mark as click-selected (glow only)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              } else if (skeletonObjKey === 'working_skeleton') {
                const frameAnn = annotations[currentFrame] || {};
                if (frameAnn.keypoints) {
                  frameAnn.keypoints.forEach((pt, idx) => {
                    if (pt) {
                      const keypointObjKey = `working_skeleton_${idx}`;
                      selectedKeypoints.current.add(keypointObjKey);
                      keypointSelectionType.current.set(keypointObjKey, 'click'); // Mark as click-selected (glow only)
                      // DON'T add to selectedObjectsMA.current - only for highlighting
                    }
                  });
                }
              }
            }

            // Maintain legacy boolean so existing drag logic still works
            setSelectedSkeleton(true);
            setSelectedBbox(false);
            draw();
            // Sync selection to sidebar
            syncSelectionToSidebar();
          } else {
            // SINGLE-ANIMAL MODE (original behaviour)
            if (ctrlPressed) {
              setSelectedSkeleton(!selectedSkeleton);
              draw();
            } else {
              setSelectedSkeleton(true);
              selectedKeypoints.current.clear();
              setSelectedBbox(false);
              draw();
            }
          }
        } else if (bboxResult) {
          if (multiAnimalMode) {
            // Multi-animal mode: handle bbox selection like skeletons
            const bboxObjKey = bboxResult.objKey; // e.g., completed_bbox_X or working_bbox
            
            // Store reference to selected bbox for dragging
            selectedBboxRef.current = bboxResult;
            
            if (ctrlPressed) {
              // Toggle selection state for this bbox
              if (selectedObjectsMA.current.has(bboxObjKey)) {
                selectedObjectsMA.current.delete(bboxObjKey);
                
                // FIXED: Update selectedImageObjects for sidebar highlighting (remove from current)
                const newSelectedImageObjects = new Set(selectedImageObjects);
                newSelectedImageObjects.delete(bboxObjKey);
                setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
                
                // If this was the last selected bbox, clear the reference
                if (!Array.from(selectedObjectsMA.current).some(key => key.includes('bbox'))) {
                  selectedBboxRef.current = null;
                  setSelectedBbox(false);
                }
              } else {
                selectedObjectsMA.current.add(bboxObjKey);
                setSelectedBbox(true);
                
                // FIXED: Update selectedImageObjects for sidebar highlighting (add to current)
                const newSelectedImageObjects = new Set(selectedImageObjects);
                newSelectedImageObjects.add(bboxObjKey);
                setSelectedImageObjects && setSelectedImageObjects(newSelectedImageObjects);
              }
            } else {
              // Select this bbox exclusively
              selectedObjectsMA.current.clear();
              selectedObjectsMA.current.add(bboxObjKey);
              setSelectedBbox(true);
              selectedKeypoints.current.clear();
              setSelectedSkeleton(false);
              
              // FIXED: Update selectedImageObjects for sidebar highlighting
              setSelectedImageObjects && setSelectedImageObjects(new Set([bboxObjKey]));
            }
            draw();
            // Sync selection to sidebar
            syncSelectionToSidebar();
          } else {
            // SINGLE-ANIMAL MODE (original behaviour)
            if (ctrlPressed) {
              const newSelection = !selectedBbox;
              setSelectedBbox(newSelection);
              // Force draw with the new selection state immediately
              draw({ selectedBbox: newSelection });
            } else {
              setSelectedBbox(true);
              selectedKeypoints.current.clear();
              setSelectedSkeleton(false);
              // Force draw with selection enabled immediately  
              draw({ selectedBbox: true });
            }
          }
        } else {
          // Click on empty space within image bounds - clear selections unless Ctrl is pressed
          if (!ctrlPressed) {
            clearAllSelections();
          }
        }
        
        // Clean up all drag preparation states
        selectedKeypoint.current = null;
        dragStartPos.current = null;
        multiKeypointDragStart.current = null;
        multiKeypointOriginalPositions.current = null;
        originalKeypointSelections.current.clear(); // Clean up keypoint selection tracking
        originalSkeletonSelections.current.clear(); // Clean up skeleton selection tracking  
        originalBboxSelections.current.clear(); // Clean up bbox selection tracking
        bboxDragStart.current = null;
        bboxOriginal.current = null;
        if (dragSelectStart.current) {
          dragSelectStart.current = null;
          dragSelectCtrl.current = false;
        }
      }
    };

    // Double click for visibility toggle
    const handleDoubleClick = (e) => {
      if (mode === 'keypoint' || spacePressed.current) return;
      
      // Prevent double-processing of the same double-click event
      e.preventDefault();
      e.stopPropagation();
      
      const canvasPos = getCanvasPos(e);
      const imagePos = mapToImageCoords(canvasPos.x, canvasPos.y);
      const keypointResult = findKeypointForDoubleClick(imagePos.x, imagePos.y);
      
      // Debounce double-click events to prevent double-processing
      const currentTime = Date.now();
      const keypointKey = keypointResult ? `${keypointResult.skeletonId}_${keypointResult.idx}` : null;
      
      if (keypointResult && 
          currentTime - lastDoubleClickTime.current < 300 && 
          lastDoubleClickKeypoint.current === keypointKey) {
        return; // Prevent double-processing
      }
      
      if (keypointResult) {
        lastDoubleClickTime.current = currentTime;
        lastDoubleClickKeypoint.current = keypointKey;
        
        // Set processing flag to prevent React from applying the same change multiple times
        processingDoubleClick.current = true;
        
        setAnnotations(prev => {
          // If we're already processing this double-click, return unchanged state
          if (!processingDoubleClick.current) {
            return prev;
          }
          
          // Mark as processed to prevent subsequent calls
          processingDoubleClick.current = false;
          
          const next = [...prev];
          const ann = next[currentFrame] || {};
          
          if (multiAnimalMode) {
            // Multi-animal mode: update visibility in the appropriate skeleton
            // Use the exact same visibility cycling logic as single-animal mode
            const skeletons = ann.skeletons ? [...ann.skeletons] : [];
            const { skeletonId, idx } = keypointResult;
            
            // Find and update in completed skeletons
            const skeletonIndex = skeletons.findIndex(s => s.id === skeletonId);
            if (skeletonIndex >= 0) {
              if (!skeletons[skeletonIndex].visibilities) {
                skeletons[skeletonIndex].visibilities = Array(keypointLabels.length).fill(2);
              }
              const vis = skeletons[skeletonIndex].visibilities[idx];
              // Cycle through visibility states: visible (2) → hidden (1) → not labeled (0) → visible (2)
              if (vis === 2) {
                skeletons[skeletonIndex].visibilities[idx] = 1; // visible → hidden
              } else if (vis === 1) {
                skeletons[skeletonIndex].visibilities[idx] = 0; // hidden → not labeled
              } else {
                skeletons[skeletonIndex].visibilities[idx] = 2; // not labeled → visible
              }
              next[currentFrame] = { 
                ...ann, 
                skeletons: skeletons,
                // Preserve other fields explicitly like single-animal mode does
                keypoints: ann.keypoints ? [...ann.keypoints] : null,
                visibilities: ann.visibilities ? [...ann.visibilities] : null,
                bboxes: ann.bboxes ? [...ann.bboxes] : undefined
              };
            } else if (ann.skeletonId === skeletonId || (ann.skeletonId === undefined && skeletonId === currentSkeletonId)) {
              // Update current working skeleton
              const workingVisibilities = ann.visibilities ? [...ann.visibilities] : Array(keypointLabels.length).fill(2);
              const vis = workingVisibilities[idx];
              // Cycle through visibility states: visible (2) → hidden (1) → not labeled (0) → visible (2)
              if (vis === 2) {
                workingVisibilities[idx] = 1; // visible → hidden
              } else if (vis === 1) {
                workingVisibilities[idx] = 0; // hidden → not labeled
              } else {
                workingVisibilities[idx] = 2; // not labeled → visible
              }
              next[currentFrame] = { 
                ...ann, 
                visibilities: workingVisibilities,
                // Preserve other fields explicitly like single-animal mode does
                keypoints: ann.keypoints ? [...ann.keypoints] : null,
                skeletons: ann.skeletons ? [...ann.skeletons] : undefined,
                bboxes: ann.bboxes ? [...ann.bboxes] : undefined
              };
            }
          } else {
            // Single animal mode: update current visibilities
          const vis = (ann.visibilities || Array(keypointLabels.length).fill(2)).slice();
            const { idx } = keypointResult;
          
          // Cycle through visibility states: visible (2) → hidden (1) → not labeled (0) → visible (2)
          if (vis[idx] === 2) {
            vis[idx] = 1; // visible → hidden
          } else if (vis[idx] === 1) {
            vis[idx] = 0; // hidden → not labeled
          } else {
            vis[idx] = 2; // not labeled → visible
          }
          
          next[currentFrame] = { 
            ...ann, 
            keypoints: (ann.keypoints || Array(keypointLabels.length).fill(null)).slice(), 
            visibilities: vis 
          };
          }
          
          return next;
        });
        
        // Force immediate redraw after state update
        setTimeout(() => {
          draw();
          processingDoubleClick.current = false;
          saveToUndoStack && saveToUndoStack();
        }, 0);
      }
    };

    // Wheel zoom - anchor under mouse like Qt's AnchorUnderMouse
    const handleWheel = (e) => {
      e.preventDefault();
      
      const canvasPos = getCanvasPos(e);
      
      // Get the image point under the cursor BEFORE zoom
      const imagePointBefore = mapToImageCoords(canvasPos.x, canvasPos.y);
      
      // Calculate new scale
      const delta = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const newScale = Math.max(0.2, Math.min(5, scale.current * delta));
      const oldScale = scale.current;
      scale.current = newScale;
      
      // Calculate where that same image point would appear with the new scale
      const { width: imgW, height: imgH } = getImageDims();
      const container = containerRef.current;
      const canvasW = container.clientWidth;
      const canvasH = container.clientHeight;
      
      // Where the image point would be displayed with new scale and current offset
      const scaledImgW = imgW * newScale;
      const scaledImgH = imgH * newScale;
      const displayX = (canvasW - scaledImgW) / 2 + offset.current.x;
      const displayY = (canvasH - scaledImgH) / 2 + offset.current.y;
      const newCanvasX = displayX + imagePointBefore.x * newScale;
      const newCanvasY = displayY + imagePointBefore.y * newScale;
      
      // Adjust offset so the image point ends up exactly where the cursor is
      const deltaX = canvasPos.x - newCanvasX;
      const deltaY = canvasPos.y - newCanvasY;
      offset.current.x += deltaX;
      offset.current.y += deltaY;
      
      draw();
    };

    // Keyboard
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        spacePressed.current = true;
        canvas.style.cursor = 'grab';
      } else if (e.key === 'Escape') {
        if (setMode) setMode(null);
        // Clear all selections on escape
        let needsRedraw = false;
        if (selectedBbox) {
          setSelectedBbox(false);
          needsRedraw = true;
        }
        if (selectedKeypoints.current.size > 0) {
          selectedKeypoints.current.clear();
          needsRedraw = true;
        }
        if (selectedSkeleton) {
          setSelectedSkeleton(false);
          needsRedraw = true;
        }
        if (needsRedraw) {
          draw();
        }
      } else if (e.key === 'Backspace' && (selectedBbox || selectedSkeleton || selectedKeypoints.current.size > 0)) {
        // Delete all selected objects together
        e.preventDefault();
        
        setAnnotations(prev => {
          const next = [...prev];
          const ann = next[currentFrame] || {};
          let newAnn = { ...ann };
          
          if (multiAnimalMode) {
            // Multi-animal mode: delete only specifically selected objects
            if (selectedObjectsMA.current.size > 0) {
              // Delete completed skeletons that are explicitly selected
              if (newAnn.skeletons) {
                newAnn.skeletons = newAnn.skeletons.filter((skeleton, index) => {
                  const skeletonKey = `completed_skeleton_${index}`;
                  return !selectedObjectsMA.current.has(skeletonKey);
                });
              }

              // Delete completed bboxes that are explicitly selected
              if (newAnn.bboxes) {
                newAnn.bboxes = newAnn.bboxes.filter((bbox, index) => {
                  const bboxKey = `completed_bbox_${index}`;
                  return !selectedObjectsMA.current.has(bboxKey);
                });
              }

              // Handle working objects if explicitly selected
              if (selectedObjectsMA.current.has('working_skeleton')) {
                delete newAnn.keypoints;
                delete newAnn.visibilities;
                delete newAnn.skeletonId;
              }
              if (selectedObjectsMA.current.has('working_bbox')) {
                delete newAnn.bbox;
                delete newAnn.bboxId;
              }
            }
            
            // Delete individual selected keypoints
            if (selectedKeypoints.current.size > 0) {
              const skeletons = newAnn.skeletons ? [...newAnn.skeletons] : [];
              let workingKeypoints = newAnn.keypoints ? [...newAnn.keypoints] : null;
              let workingVisibilities = newAnn.visibilities ? [...newAnn.visibilities] : null;
              
              selectedKeypoints.current.forEach(objKey => {
                const infoDel = getObjKeyInfo(objKey, annotations[currentFrame] || {}, currentSkeletonId);
                
                if (infoDel.pattern === 'completed' && infoDel.skeletonIndex !== null) {
                  // Delete keypoint from completed skeleton
                  if (skeletons[infoDel.skeletonIndex] && skeletons[infoDel.skeletonIndex].keypoints) {
                    skeletons[infoDel.skeletonIndex].keypoints[infoDel.kpIdx] = null;
                    if (skeletons[infoDel.skeletonIndex].visibilities) {
                      skeletons[infoDel.skeletonIndex].visibilities[infoDel.kpIdx] = 0;
                    }
                  }
                } else if (infoDel.pattern === 'working' && workingKeypoints && workingVisibilities) {
                  // Delete keypoint from working skeleton
                  workingKeypoints[infoDel.kpIdx] = null;
                  workingVisibilities[infoDel.kpIdx] = 0;
                }
              });
              
              newAnn.skeletons = skeletons;
              newAnn.keypoints = workingKeypoints;
              newAnn.visibilities = workingVisibilities;
            }
          } else {
            // Single animal mode: delete current objects
            if (selectedBbox) {
              delete newAnn.bbox;
              delete newAnn.bboxId;
            }
            
            if (selectedSkeleton) {
              delete newAnn.keypoints;
              delete newAnn.visibilities;
              delete newAnn.skeletonId;
            }
            
            // Delete individual selected keypoints
            if (selectedKeypoints.current.size > 0 && !selectedSkeleton) {
              const keypoints = newAnn.keypoints ? [...newAnn.keypoints] : null;
              const visibilities = newAnn.visibilities ? [...newAnn.visibilities] : null;
              
              if (keypoints && visibilities) {
                selectedKeypoints.current.forEach(objKey => {
                  const infoDel = getObjKeyInfo(objKey, annotations[currentFrame] || {}, currentSkeletonId);
                  keypoints[infoDel.kpIdx] = null;
                  visibilities[infoDel.kpIdx] = 0;
                });
                
                newAnn.keypoints = keypoints;
                newAnn.visibilities = visibilities;
              }
            }
          }
          
          next[currentFrame] = newAnn;
          return next;
        });
        
        // Clear all selections after deletion
        setSelectedBbox(false);
        setSelectedSkeleton(false);
        selectedKeypoints.current.clear();
        
        // Save to undo stack after deletion
        setTimeout(() => saveToUndoStack && saveToUndoStack(), 0);
        draw();
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        handleHideObjects();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        spacePressed.current = false;
        canvas.style.cursor = mode === 'keypoint' ? CIRCLE_CURSOR : 
                            mode === 'bbox' ? 'crosshair' : 'default';
      }
    };

    // Attach events
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
          canvas.addEventListener('mouseleave', handleMouseUp); // Simplified: just call handleMouseUp on leave
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('dblclick', handleDoubleClick);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      canvas.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentFrame, mode, keypointIndex, keypointLabels, skeletonConnections, annotations, setAnnotations, setKeypointIndex, setMode, saveToUndoStack]);

  return (
    <div ref={containerRef} style={{ 
      position: 'relative', 
      width: '900px', 
      height: '700px', 
      background: '#222', 
      borderRadius: '10px', 
      overflow: 'hidden' 
    }}>
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          style={{ display: 'none' }}
        />
      )}
      {imageUrl && (
        <img
          src={imageUrl}
          alt="frame"
          style={{ display: 'none' }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'auto',
          zIndex: 2,
        }}
      />
      <canvas
        ref={textCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 3,
        }}
      />
    </div>
  );
});

export default VideoPlayer; 