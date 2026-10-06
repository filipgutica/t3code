export type ImageCrop = { x: number; y: number; width: number; height: number };
export type ProductImageDescriptor = {
  src: string;
  srcset: string;
  original: string;
  width: number;
  height: number;
  alt: string;
  sizes: string;
  eager: boolean;
  crop?: ImageCrop;
};
export type WalkthroughStep = {
  id: string;
  tab: string;
  title: string;
  caption: string;
  image: ProductImageDescriptor;
};
