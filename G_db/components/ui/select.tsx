"use client";

import * as Select from "@radix-ui/react-select";
import { useCallback, useState } from "react";
import { FiCheck, FiChevronDown } from "react-icons/fi";

type Option = string | { value: string; label: string };

export function GarageSelect({ label, name, defaultValue, value, onValueChange, options, placeholder, required, compact }: {
  label: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: readonly Option[];
  placeholder?: string;
  required?: boolean;
  compact?: boolean;
}) {
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const attachTrigger = useCallback((trigger: HTMLButtonElement | null) => {
    if (trigger) setContainer(trigger.closest("dialog") ?? undefined);
  }, []);

  return (
    <Select.Root name={name} value={value} defaultValue={defaultValue} onValueChange={onValueChange} required={required}>
      <Select.Trigger ref={attachTrigger} aria-label={label} className={`garage-select${compact ? " garage-select-compact" : ""}`}>
        <Select.Value placeholder={placeholder ?? label} />
        <Select.Icon asChild><FiChevronDown aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Content className="garage-select-content" position="popper" sideOffset={5} collisionPadding={12}>
          <Select.ScrollUpButton className="garage-select-scroll"><FiChevronDown className="up" aria-hidden="true" /></Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => {
              const item = typeof option === "string" ? { value: option, label: option } : option;
              return (
                <Select.Item key={item.value} value={item.value} className="garage-select-item">
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator><FiCheck aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
          <Select.ScrollDownButton className="garage-select-scroll"><FiChevronDown aria-hidden="true" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
