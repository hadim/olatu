// shadcn's class-merge helper: clsx for conditional classes + tailwind-merge so the
// last conflicting utility wins (e.g. `px-2` overriding an earlier `px-4`).
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
