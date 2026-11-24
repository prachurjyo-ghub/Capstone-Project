'use client';

import * as Primitive from '@radix-ui/react-dialog';
import { forwardRef } from 'react';

export const Root = Primitive.Root;
export const Portal = Primitive.Portal;
export const Trigger = Primitive.Trigger;
export const Close = Primitive.Close;
export const Title = Primitive.Title;
export const Description = Primitive.Description;

export const Overlay = forwardRef<
  React.ElementRef<typeof Primitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof Primitive.Overlay>
>(({ className = '', ...props }, ref) => <Primitive.Overlay ref={ref} className={`fixed inset-0 bg-black/50 ${className}`} {...props} />);
Overlay.displayName = 'DialogOverlay';

export const Content = forwardRef<
  React.ElementRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className = '', ...props }, ref) => <Primitive.Content ref={ref} className={`rounded-xl bg-[var(--surface)] shadow-2xl ${className}`} {...props} />);
Content.displayName = 'DialogContent';
