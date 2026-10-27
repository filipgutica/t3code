export type ProductImageSource = {
  src: string;
  srcset: string;
  original: string;
  width: number;
  height: number;
};
export type ProductImageDescriptor = ProductImageSource & {
  light: ProductImageSource;
  alt: string;
  sizes: string;
  eager: boolean;
};
