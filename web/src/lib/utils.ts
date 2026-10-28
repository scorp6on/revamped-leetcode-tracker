import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Joins class names and lets a later Tailwind class override an earlier one (e.g. a caller's h-9 beats h-11).
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
