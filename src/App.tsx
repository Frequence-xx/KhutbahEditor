import { TitleBar } from './components/TitleBar';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar project="Hello World" />
      <main className="flex-1 flex items-center justify-center">
        <p className="font-arabic text-3xl text-amber" dir="rtl">السلام عليكم ورحمة الله</p>
      </main>
    </div>
  );
}
