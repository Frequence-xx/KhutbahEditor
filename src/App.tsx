import { useEffect } from 'react';
import { Shell } from './screens/Shell';
import { useSettings } from './store/settings';

export default function App() {
  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  return <Shell />;
}
