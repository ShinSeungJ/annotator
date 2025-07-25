import React from 'react';

const Toolbar = ({ onVideoLoad, onImagesLoad, onLoadAnnotations, onPrevFrame, onNextFrame, onFrameChange, currentFrame, totalFrames, onExport, currentImageName }) => {
  const handleVideoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onVideoLoad(file);
      // Remove focus from input to allow keyboard shortcuts to work
      e.target.blur();
    }
  };

  const handleImagesChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      onImagesLoad(files);
      // Remove focus from input to allow keyboard shortcuts to work
      e.target.blur();
    }
  };

  // Frame indicator always at least 1/1
  const frameDisplay = `${Math.max(0, currentFrame)} / ${Math.max(0, totalFrames - 1)}`;

  // Dynamic styles using CSS variables
  const buttonStyle = {
    color: 'var(--text-primary)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 4,
    padding: '4px 8px',
    cursor: 'pointer'
  };

  const primaryButtonStyle = {
    color: 'var(--text-primary)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 6,
    padding: '8px 18px',
    fontWeight: 600,
    cursor: 'pointer'
  };

  const exportButtonStyle = {
    color: 'var(--text-primary)',
    background: 'var(--bg-quaternary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: 6,
    padding: '8px 18px',
    fontWeight: 600,
    cursor: 'pointer'
  };

  const frameDisplayStyle = {
    color: 'var(--text-primary)',
    fontWeight: 500,
    marginBottom: 2
  };

  return (
    <div className="toolbar" style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '1rem' }}>
      <label style={{ marginRight: 8, color: 'var(--text-primary)' }}>
        Images
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleImagesChange}
          style={{ display: 'inline-block', marginLeft: 4 }}
        />
      </label>
      <label style={{ marginRight: 8, color: 'var(--text-primary)' }}>
        Video
      <input
        type="file"
        accept="video/*"
          onChange={handleVideoChange}
          style={{ display: 'inline-block', marginLeft: 4 }}
        />
      </label>
      <button
        onClick={onLoadAnnotations}
        style={{ ...primaryButtonStyle, marginRight: 8 }}
      >
        Load Annotations
      </button>
      <button
        onClick={onPrevFrame}
        disabled={currentFrame <= 0}
        style={{ ...buttonStyle, marginRight: 4, opacity: currentFrame <= 0 ? 0.5 : 1 }}
      >
        Prev
      </button>
      <button
        onClick={onNextFrame}
        disabled={currentFrame >= totalFrames - 1}
        style={{ ...buttonStyle, marginRight: 8, opacity: currentFrame >= totalFrames - 1 ? 0.5 : 1 }}
      >
        Next
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 320 }}>
        <span style={frameDisplayStyle}>Frame: {frameDisplay}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={currentFrame}
          onChange={e => onFrameChange(Number(e.target.value))}
          style={{ width: '100%', maxWidth: 300 }}
          disabled={totalFrames <= 1}
        />
        {currentImageName && (
          <span style={{ 
            fontSize: '0.85rem', 
            color: 'var(--text-secondary)', 
            marginTop: 4,
            fontStyle: 'italic'
          }}>
            📄 {currentImageName}
          </span>
        )}
      </div>
      <button
        onClick={onExport}
        style={{ ...exportButtonStyle, marginLeft: 16 }}
      >
        Export YOLO
      </button>
    </div>
  );
};

export default Toolbar; 