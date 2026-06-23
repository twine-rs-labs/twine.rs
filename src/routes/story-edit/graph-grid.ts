export const graphSnapGridSize = 25;
export const graphSnapMajorGridSize = graphSnapGridSize * 5;

export function snapToGraphGrid(value: number) {
	return Math.round(value / graphSnapGridSize) * graphSnapGridSize;
}
