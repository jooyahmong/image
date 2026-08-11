declare module "imagetracerjs" {
  type TraceColor = { r: number; g: number; b: number; a: number };
  type TraceOptions = {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    colorsampling?: number;
    numberofcolors?: number;
    colorquantcycles?: number;
    layering?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    pal?: TraceColor[];
  };

  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: TraceOptions): string;
  };

  export default ImageTracer;
}
