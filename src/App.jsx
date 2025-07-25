import React, { useState } from 'react';
import VideoAnnotator from './components/VideoAnnotator';
import './styles/App.css';

function App() {
  const [darkMode, setDarkMode] = useState(true);

  return (
    <div className={`app-container ${darkMode ? 'dark-theme' : ''}`}>
      <div className="App">
        <h1>Annotator</h1>
        <VideoAnnotator darkMode={darkMode} setDarkMode={setDarkMode} />
      </div>
    </div>
  );
}

export default App; 