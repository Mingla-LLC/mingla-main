declare module 'supercluster' {
  export interface ClusterProperties {
    cluster: true;
    cluster_id: number;
    point_count: number;
    point_count_abbreviated: string | number;
  }

  export interface Options<P = unknown, C = unknown> {
    minZoom?: number;
    maxZoom?: number;
    minPoints?: number;
    radius?: number;
    extent?: number;
    nodeSize?: number;
    log?: boolean;
    generateId?: boolean;
    reduce?: (accumulated: C, properties: P) => void;
    map?: (properties: P) => C;
  }

  export default class Supercluster<P = unknown, C = unknown> {
    constructor(options?: Options<P, C>);
    load(points: GeoJSON.Feature<GeoJSON.Point, P>[]): Supercluster<P, C>;
    getClusters(
      bbox: [westLng: number, southLat: number, eastLng: number, northLat: number],
      zoom: number,
    ): Array<GeoJSON.Feature<GeoJSON.Point, P | ClusterProperties>>;
    getClusterExpansionZoom(clusterId: number): number;
  }
}
