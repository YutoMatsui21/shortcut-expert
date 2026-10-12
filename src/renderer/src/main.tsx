import { createRoot } from 'react-dom/client';
import { CoachApp } from './CoachApp';
import { NoticeApp } from './NoticeApp';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');
const mode = new URLSearchParams(location.search).get('mode');
createRoot(root).render(mode === 'notice' ? <NoticeApp /> : <CoachApp />);
