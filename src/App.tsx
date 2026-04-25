import { TitleBar } from './components/TitleBar';
import { useIpcOnce } from './hooks/useIpc';

export default function App() {
  const { data, error } = useIpcOnce<{ ok: boolean; version: string }>('ping');
  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar project="Hello World" right={
        <span className={data?.ok ? 'text-green' : 'text-text-muted'}>
          {data?.ok ? `● Pipeline v${data.version}` : error ? '✕ Pipeline error' : '… connecting'}
        </span>
      } />
      <main className="flex-1 flex items-center justify-center font-arabic text-3xl text-amber" dir="rtl" lang="ar">
        السلام عليكم ورحمة الله
      </main>
    </div>
  );
}
