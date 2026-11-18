import { renderToString } from 'react-dom/server';
import App from './App';
import { InitialAuthPayload } from './lib/authContext';

export function render(url: string, initialAuth?: InitialAuthPayload): string {
  return renderToString(<App initialUrl={url} initialAuth={initialAuth} />);
}
