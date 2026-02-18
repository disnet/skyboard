let discovering = $state(false);

export function getDiscoveryState() {
  return {
    get isDiscovering() {
      return discovering;
    },
  };
}

export function setDiscovering(value: boolean) {
  discovering = value;
}
