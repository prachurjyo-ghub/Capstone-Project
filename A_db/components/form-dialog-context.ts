"use client";

import { createContext } from "react";

export const FormDialogCompletion = createContext<(() => void) | null>(null);
