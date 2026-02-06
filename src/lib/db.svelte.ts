import { liveQuery, type Observable } from 'dexie';

export class QueryRune<T> {
	current = $state<T | undefined>(undefined);

	constructor(observable: Observable<T>) {
		$effect(() => {
			const sub = observable.subscribe(
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
	return new QueryRune(liveQuery(querier));
}
