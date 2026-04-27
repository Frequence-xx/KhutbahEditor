// Global setup for renderer tests:
// auto-cleanup the DOM after each test so tests stay isolated without
// requiring `afterEach(cleanup)` in every component test file.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
