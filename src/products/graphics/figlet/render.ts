import figlet from "figlet";

export type Fonts = figlet.Fonts;

export interface RenderOptions {
  text: string;
  font?: Fonts;
  width?: number;
}

export function listFonts(): string[] {
  return figlet.fontsSync();
}

export async function render({ text, font, width }: RenderOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    figlet.text(
      text,
      {
        font: font ?? "Standard",
        width,
        whitespaceBreak: width !== undefined,
      },
      (err, data) => {
        if (err) return reject(err);
        if (!data) return reject(new Error("figlet returned empty output"));
        resolve(data);
      },
    );
  });
}
