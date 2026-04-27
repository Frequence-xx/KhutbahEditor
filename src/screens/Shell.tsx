import { useMemo, useState } from 'react';
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
import { JobManager } from '../jobs/JobManager';
import type { Bridge, ProgressEvent } from '../jobs/types';

const bridge: Bridge = {
  call: <T,>(method: string, params?: unknown) =>
    window.khutbah!.pipeline.call<T>(method, params as object | undefined),
  onProgress: (l: (ev: ProgressEvent) => void) =>
    window.khutbah!.pipeline.onProgress((ev) => l(ev as unknown as ProgressEvent)),
  auth: {
    accessToken: (channelId: string) =>
      window.khutbah!.auth.accessToken(channelId) as Promise<{ accessToken: string }>,
  },
};

export function Shell() {
  const [modalOpen, setModalOpen] = useState(false);
  const projects = useProjects((s) => s.projects);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const view = useUi((s) => s.view);
  const select = useUi((s) => s.select);
  const setView = useUi((s) => s.setView);

  const project = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );
  const jm = useMemo(() => new JobManager(bridge), []);

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
    void window
      .khutbah!.pipeline.call('align.dual_file', { video_path: videoPath, audio_path: audioPath })
      .then(() => jm.startDetect(id));
    setModalOpen(false);
  };

  let rightPane;
  if (view === 'settings') {
    // Settings is reachable from any state, including when no project exists.
    rightPane = <SettingsPane />;
  } else if (!project) {
    rightPane = <EmptyState onNew={() => setModalOpen(true)} />;
  } else if (view === 'upload') {
    rightPane = (
      <UploadPane
        project={project}
        projectName={project.sourcePath.split('/').pop() ?? ''}
        onStart={(opts) => jm.startUpload(project.id, opts)}
      />
    );
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
