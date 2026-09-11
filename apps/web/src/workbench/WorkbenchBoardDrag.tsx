import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export type WorkbenchDraggableTicketRenderProps = Pick<
  ReturnType<typeof useDraggable>,
  "attributes" | "listeners" | "setActivatorNodeRef" | "isDragging"
>;

export function WorkbenchDraggableTicket({
  id,
  disabled,
  children,
}: {
  readonly id: string;
  readonly disabled: boolean;
  readonly children: (props: WorkbenchDraggableTicketRenderProps) => ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging } = useDraggable({
    id,
    disabled,
  });

  return (
    <div ref={setNodeRef} className={isDragging ? "opacity-50" : undefined}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

export function WorkbenchDropColumn({
  id,
  disabled,
  className,
  children,
  label,
  statusId,
}: {
  readonly id: string;
  readonly disabled: boolean;
  readonly className: string;
  readonly children: ReactNode;
  readonly label: string;
  readonly statusId: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled });

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-workbench-status={statusId}
      className={cn(className, isOver && !disabled && "ring-2 ring-primary/40")}
    >
      {children}
    </section>
  );
}
