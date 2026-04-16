import React from 'react';
import { logger } from '../../utils/logger';

interface SearchErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class SearchErrorBoundary extends React.Component<React.PropsWithChildren, SearchErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Błąd komponentu wyszukiwarki:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h3>Błąd wyszukiwania</h3>
          <p>{this.state.error?.toString()}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SearchErrorBoundary;
