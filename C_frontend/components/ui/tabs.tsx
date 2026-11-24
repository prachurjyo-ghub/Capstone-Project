'use client';

import * as Primitive from '@radix-ui/react-tabs';
import { forwardRef } from 'react';

export const Root = Primitive.Root;
export const Content = Primitive.Content;

export const List = forwardRef<
  React.ElementRef<typeof Primitive.List>,
  React.ComponentPropsWithoutRef<typeof Primitive.List>
>(({ className = '', ...props }, ref) => <Primitive.List ref={ref} className={`flex border-b border-[var(--line)] ${className}`} {...props} />);
List.displayName = 'TabsList';

export const Trigger = forwardRef<
  React.ElementRef<typeof Primitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(({ className = '', ...props }, ref) => <Primitive.Trigger ref={ref} className={`min-h-11 border-b-[3px] border-transparent data-[state=active]:border-[#2478f2] ${className}`} {...props} />);
Trigger.displayName = 'TabsTrigger';
