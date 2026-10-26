// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import '../helpers/dom-cleanup';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {`Clics: ${count}`}
    </button>
  );
}

describe('herramientas de prueba de componentes', () => {
  it('RNF-F7: el docblock activa jsdom y un párrafo se encuentra por rol', () => {
    render(<p>Hola</p>);
    expect(typeof document).toBe('object');
    expect(screen.getByRole('paragraph').textContent).toBe('Hola');
  });

  it('RNF-F7: fireEvent dentro de act actualiza el componente (dos clics en la misma actuación)', () => {
    render(<Counter />);
    const button = screen.getByRole('button');
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(button.textContent).toBe('Clics: 2');
  });

  it('RNF-F7: el DOM se limpia entre pruebas', () => {
    expect(screen.queryByRole('button')).toBeNull();
  });
});
