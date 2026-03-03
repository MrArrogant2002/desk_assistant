export type ConfirmFn = (title: string, filePath: string, before: string, after: string) => Promise<boolean>;
export type SimpleConfirmFn = (title: string, detail: string) => Promise<boolean>;
