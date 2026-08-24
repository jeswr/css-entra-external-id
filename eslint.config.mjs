import opinionated from 'opinionated-eslint-config';

export default opinionated().append({
  ignores: [ 'coverage/', 'dist/', 'componentsjs-error-state.json' ],
});
