import { liveQuery } from 'dexie';

export class QueryRune<T> {
	current = $state<T | undefined>(undefined);

	constructor(querier: () => T | Promise<T>) {
		$effect(() => {
			// Run querier synchronously to track Svelte reactive dependencies
			// (e.g. $derived values used inside the querier). The result is discarded;
			// Dexie's liveQuery re-invokes it for proper table observation.
			try {
				querier();
			} catch {
				/* noop */
			}

			const sub = liveQuery(querier).subscribe(
				(value) => {
					this.current = value;
				},
				(error) => {
					console.error('liveQuery error:', error);
				}
			);
			return () => sub.unsubscribe();
		});
	}
}

export function useLiveQuery<T>(querier: () => T | Promise<T>): QueryRune<T> {
	return new QueryRune(querier);
}
