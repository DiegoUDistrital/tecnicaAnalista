// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskCard } from '../../src/client/task-card';
import '../helpers/dom-cleanup';
import { makeTask } from '../helpers/fake-api';

const WITH_DESCRIPTION = makeTask(1, { description: 'línea uno\nlínea dos' });
const titleButton = () => screen.getByRole('button', { name: 'Tarea 1', expanded: false });

describe('TaskCard: descripción plegable', () => {
  it('RF-V11: la descripción está plegada por defecto y el título (botón) la muestra y la oculta', () => {
    render(<TaskCard task={WITH_DESCRIPTION} />);
    const button = titleButton();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/línea uno/)).toBeNull();
    expect(button.closest('h3')).toBeTruthy();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const description = screen.getByText(/línea uno/);
    expect(description.textContent).toBe('línea uno\nlínea dos');
    expect(description.className).toContain('whitespace-pre-wrap');
    expect(button.getAttribute('aria-controls')).toBe(description.id);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/línea uno/)).toBeNull();
  });

  it('RF-V11: estado y fecha siguen visibles con la descripción plegada', () => {
    render(<TaskCard task={WITH_DESCRIPTION} />);
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(document.querySelector('time')).toBeTruthy();
  });

  it('RF-V11: una tarea sin descripción no tiene botón de título ni chevron', () => {
    render(<TaskCard task={makeTask(1)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Tarea 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tarea 1' })).toBeNull();
    expect(document.querySelector('h3 svg')).toBeNull();
  });

  it('RF-V11: con descripción hay chevron decorativo que cambia al abrir y el botón es nativo (Enter/Espacio)', () => {
    render(<TaskCard task={WITH_DESCRIPTION} />);
    const button = titleButton();
    const chevron = button.querySelector('svg');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.parentElement?.classList).not.toContain('rotate-180');
    // Enter y Espacio activan un <button> nativo (el navegador los convierte en clic): no hay manejador de teclado.
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(chevron?.parentElement?.classList).toContain('rotate-180');
    fireEvent.click(button);
    expect(chevron?.parentElement?.classList).not.toContain('rotate-180');
  });

  it('RF-V11: el botón de título lleva tamaño táctil, foco visible, cursor y las clases anti-desbordamiento', () => {
    render(<TaskCard task={makeTask(1, { title: 'x'.repeat(100), description: 'd' })} />);
    const button = screen.getByRole('button', { name: 'x'.repeat(100) });
    for (const name of ['min-h-11', 'min-w-11', 'cursor-pointer', 'text-left']) {
      expect(button.classList, button.outerHTML).toContain(name);
    }
    expect(button.className).toContain('focus-visible:outline-2');
    expect(screen.getByRole('article').classList).toContain('wrap-anywhere');
    expect(screen.getByText('x'.repeat(100)).classList).toContain('min-w-0');
  });
});
