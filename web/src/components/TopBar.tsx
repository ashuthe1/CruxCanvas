import { STATUS_LABEL, type Project, type ProjectStatus } from '../lib/projects';

/** Editor chrome: session identity, status, save state and the global actions. */
export function TopBar({
  project,
  brandName,
  brandColor,
  onBack,
  onRename,
  onStar,
  onStatus,
  onExport,
  onNewPage,
}: {
  project: Project;
  brandName?: string;
  brandColor?: string;
  onBack: () => void;
  onRename: (title: string) => void;
  onStar: () => void;
  onStatus: (s: ProjectStatus) => void;
  onExport: () => void;
  onNewPage: () => void;
}) {
  return (
    <div className="topbar">
      <button className="back" onClick={onBack} title="Back to all sessions">
        ← Sessions
      </button>
      <span className="crumb-sep">/</span>
      <span className="brand-pill" title="Brand workspace">
        <i style={{ background: brandColor || '#94a3b8' }} /> {brandName || project.brandId}
      </span>
      <input
        className="title"
        defaultValue={project.title}
        key={project.id}
        onBlur={(e) => e.target.value.trim() && e.target.value !== project.title && onRename(e.target.value.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="topbar-right">
        <button className={`star ${project.starred ? 'on' : ''}`} title={project.starred ? 'Unstar' : 'Star this session'} onClick={onStar}>
          {project.starred ? '★' : '☆'}
        </button>
        <select className={`status ${project.status}`} value={project.status} onChange={(e) => onStatus(e.target.value as ProjectStatus)}>
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <div className="topbar-actions">
          <button className="btn-ghost" onClick={onNewPage} title="Add a blank page">
            ＋ Page
          </button>
          <button className="btn-primary" onClick={onExport} title="Download all pages as PNG (zip)">
            ⬇ Export
          </button>
        </div>
      </div>
    </div>
  );
}
