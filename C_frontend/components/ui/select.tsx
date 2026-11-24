'use client';

import * as Primitive from '@radix-ui/react-select';
import { forwardRef } from 'react';

export const Root = Primitive.Root;
export const Portal = Primitive.Portal;
export const Value = Primitive.Value;
export const Icon = Primitive.Icon;
export const Viewport = Primitive.Viewport;
export const ItemText = Primitive.ItemText;
export const ItemIndicator = Primitive.ItemIndicator;

export const Trigger = forwardRef<
  React.ElementRef<typeof Primitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(({ className = '', ...props }, ref) => <Primitive.Trigger ref={ref} className={`min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] ${className}`} {...props} />);
Trigger.displayName = 'SelectTrigger';

export const Content = forwardRef<
  React.ElementRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className = '', ...props }, ref) => <Primitive.Content ref={ref} className={`z-50 rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-xl ${className}`} {...props} />);
Content.displayName = 'SelectContent';

export const Item = forwardRef<
  React.ElementRef<typeof Primitive.Item>,
  React.ComponentPropsWithoutRef<typeof Primitive.Item>
>(({ className = '', ...props }, ref) => <Primitive.Item ref={ref} className={`cursor-pointer rounded-md outline-none data-[highlighted]:bg-[var(--accent-soft)] ${className}`} {...props} />);
Item.displayName = 'SelectItem';
