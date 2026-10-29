import { createRoot } from 'react-dom/client';
import { CoachApp } from './CoachApp';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
createRoot(root).render(<CoachApp />);
