import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import App from './App';
import { ThemeProvider } from './lib/theme';
import { LocaleProvider } from './lib/i18n';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <TooltipProvider delayDuration={150}>
          <App />
        </TooltipProvider>
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
);
