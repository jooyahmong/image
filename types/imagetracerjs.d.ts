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
    blurradius?: number;
    blurdelta?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    pal?: TraceColor[];
  };

  type TraceSegment = {
    type: "L" | "Q";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    x3?: number;
    y3?: number;
  };

  type TracePath = {
    segments: TraceSegment[];
    boundingbox: [number, number, number, number];
    holechildren: number[];
    isholepath: boolean;
  };

  type TraceData = {
    layers: TracePath[][];
    palette: TraceColor[];
    width: number;
    height: number;
  };

  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: TraceOptions): string;
    imagedataToTracedata(imageData: ImageData, options?: TraceOptions): TraceData;
  };

  export default ImageTracer;
}
