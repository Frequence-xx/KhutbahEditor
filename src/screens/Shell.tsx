import { useEffect, useMemo, useState } from 'react';
import { useProjects } from '../store/projects';
import { useUi } from '../store/ui';
import { Sidebar } from '../components/Sidebar';
import { EmptyState } from '../components/EmptyState';
import { NewKhutbahModal } from '../components/NewKhutbahModal';
import { ReviewPane } from '../components/ReviewPane';
import { DetectingPane } from '../components/DetectingPane';
import { ErrorPane } from '../components/ErrorPane';
import { UploadPane } from '../components/UploadPane';
import { SettingsPane } from '../components/SettingsPane';
import { Toaster } from '../components/Toaster';
import { getJobManager } from '../jobs/instance';

export function Shell() {
  const [modalOpen, setModalOpen] = useState(false);
  const projects = useProjects((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const view = useUi((s) => s.view);
  const select = useUi((s) => s.select);
  const clearSelection = useUi((s) => s.clearSelection);
  const setView = useUi((s) => s.setView);

  const project = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const jm = getJobManager();

  const handleSubmitYoutube = (url: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id,
      sourcePath: url,
      duration: 0,
      createdAt: Date.now(),
      runState: 'idle',
    });
    select(id);
    jm.startDetect(id);
    setModalOpen(false);
  };
  const handleSubmitLocal = (path: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id,
      sourcePath: path,
      duration: 0,
      createdAt: Date.now(),
      runState: 'idle',
    });
    select(id);
    jm.startDetect(id);
    setModalOpen(false);
  };
  const handleDelete = (id: string) => {
    const p = useProjects.getState().projects.find((x) => x.id === id);
    const name = p?.sourcePath.split('/').pop() ?? 'this project';
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    jm.cancel(id);
    useProjects.getState().remove(id);
    if (selectedProjectId === id) clearSelection();
  };
  const handleSubmitDual = (audioPath: string, videoPath: string) => {
    const id = `proj-${Date.now()}`;
    useProjects.getState().add({
      id,
      sourcePath: videoPath,
      duration: 0,
      createdAt: Date.now(),
      runState: 'idle',
    });
    select(id);
    jm.startDetectDual(id, videoPath, audioPath);
    setModalOpen(false);
  };

  // After upload completes, return to review (which now shows the ✓ uploaded
  // status) so the user isn't stranded on UploadPane with a re-enabled button.
  useEffect(() => {
    if (view === 'upload' && project?.runState === 'uploaded') {
      setView('review');
    }
  }, [view, project?.runState, setView]);

  // Priority order: settings → !project → error → detecting/cutting → upload
  // → review. Error MUST come before upload so an upload failure surfaces
  // the Retry button instead of leaving an enabled "Upload" button.
  let rightPane;
  if (view === 'settings') {
    rightPane = <SettingsPane />;
  } else if (!project) {
    rightPane = <EmptyState onNew={() => setModalOpen(true)} />;
  } else if (project.runState === 'error') {
    rightPane = (
      <ErrorPane
        message={project.lastError ?? 'Unknown error'}
        onRetry={() => jm.retry(project.id)}
      />
    );
  } else if (project.runState === 'detecting' || project.runState === 'cutting') {
    rightPane = (
      <DetectingPane
        projectName={project.sourcePath.split('/').pop() ?? ''}
        progress={project.progress}
        stage={project.runState === 'detecting' ? 'Detecting boundaries' : 'Re-cutting'}
      />
    );
  } else if (view === 'upload') {
    rightPane = (
      <UploadPane
        project={project}
        projectName={project.sourcePath.split('/').pop() ?? ''}
        onStart={(opts) => jm.startUpload(project.id, opts)}
      />
    );
  } else {
    rightPane = (
      <ReviewPane
        project={project}
        onAccept={() => setView('upload')}
        onNudge={(b, d) => jm.startCut(project.id, b, d)}
      />
    );
  }

  return (
    <div className="h-screen flex bg-slate-900 text-slate-100">
      <Sidebar
        selectedId={selectedProjectId}
        onSelect={select}
        onNew={() => setModalOpen(true)}
        onSettings={() => setView('settings')}
        onDelete={handleDelete}
      />
      <main className="flex-1 min-w-0">{rightPane}</main>
      <NewKhutbahModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitYoutube={handleSubmitYoutube}
        onSubmitLocal={handleSubmitLocal}
        onSubmitDual={handleSubmitDual}
      />
      <Toaster />
    </div>
  );
}
