export type ProductImageSource = {
  src: string;
  srcset: string;
  original: string;
  width: number;
  height: number;
};
export type ProductImageDescriptor = ProductImageSource & {
  light: ProductImageSource;
  /** The viewer's title: a short name, where alt describes the image. */
  title: string;
  alt: string;
  sizes: string;
  eager: boolean;
};
