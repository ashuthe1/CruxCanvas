declare module 'potrace' {
  export function trace(file: string | Buffer, options: Record<string, any>, cb: (err: any, svg: string) => void): void;
  export function posterize(file: string | Buffer, options: Record<string, any>, cb: (err: any, svg: string) => void): void;
  const _default: { trace: typeof trace; posterize: typeof posterize };
  export default _default;
}
