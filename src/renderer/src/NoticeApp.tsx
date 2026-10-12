import { useEffect, useState } from 'react';
import type { Notice } from '../../shared/coach';

export function NoticeApp() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => { void window.coach.getNotice().then(setNotice); }, []);
  return <div className="notice" role="status">
    <span className="notice-label">{notice?.label}</span><strong>{notice?.shortcut}</strong>
  </div>;
}

