export interface MeasurableRef {
  current: unknown;
}

type MeasureFn = (cb: (x: number, y: number, w: number, h: number) => void) => void;

/**
 * Calls measureInWindow only when the ref holds a host view that really has it.
 * Composite refs (KeyboardAvoidingView) do not, and calling them throws.
 * Returns whether a measurement was requested.
 */
export function measureHostInWindow(
  ref: MeasurableRef | null | undefined,
  cb: (rect: { x: number; y: number; width: number; height: number }) => void,
): boolean {
  const node = ref?.current as { measureInWindow?: unknown } | null | undefined;
  if (!node || typeof node.measureInWindow !== "function") return false;
  (node.measureInWindow as MeasureFn).call(node, (x, y, width, height) => cb({ x, y, width, height }));
  return true;
}
