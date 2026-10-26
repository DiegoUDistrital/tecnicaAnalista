import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../../src/app/page';

describe('página provisional', () => {
  it('RF-F28: la página provisional renderiza un único h1', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });
});
