import { fireEvent, screen } from '@testing-library/react';

/** Botón que abre y cierra el panel del formulario de crear (RF-V7). */
export const newTaskButton = () => screen.getByRole('button', { name: 'Nueva tarea' });

/** Abre el panel «Nueva tarea»: el formulario de crear empieza cerrado. */
export function openPanel() {
  fireEvent.click(newTaskButton());
}
