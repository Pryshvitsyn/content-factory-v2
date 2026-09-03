import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { QualityRecoveryConsole } from './QualityRecoveryConsole';
import { KeyframeValidationConsole } from './KeyframeValidationConsole';
import './styles.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /><QualityRecoveryConsole /><KeyframeValidationConsole /></React.StrictMode>);
