import { useColorStore } from '../../stores/colorStore';

export function useMapColors() {
  const startPoints                    = useColorStore(s => s.startPoints);
  const clrGeneral                     = useColorStore(s => s.generalAirport);
  const clrDestination                 = useColorStore(s => s.destinationAirport);
  const clrTripAirport                 = useColorStore(s => s.tripAirport);
  const clrTripRoute                   = useColorStore(s => s.tripRoute);
  const clrTransferRoute               = useColorStore(s => s.transferRoute);
  const clrTripHover                   = useColorStore(s => s.tripAirportHover);
  const clrGeneralHover                = useColorStore(s => s.generalAirportHover);
  const clrDestinationHover            = useColorStore(s => s.destinationAirportHover);
  const clrTransferRouteHover          = useColorStore(s => s.transferRouteHover);
  const clrGeneralLabelHover           = useColorStore(s => s.generalLabelHoverColor);
  const clrGeneralLabel                = useColorStore(s => s.generalLabelColor);
  const clrDestinationLabel            = useColorStore(s => s.destinationLabelColor);
  const clrDestinationLabelHover       = useColorStore(s => s.destinationLabelHoverColor);
  const clrTripLabel                   = useColorStore(s => s.tripLabelColor);
  const clrTripLabelHover              = useColorStore(s => s.tripLabelHoverColor);
  const szRouteWidthMin                = useColorStore(s => s.routeLineWidthMin);
  const szRouteWidthMax                = useColorStore(s => s.routeLineWidthMax);
  const szRouteHoverWidthMin           = useColorStore(s => s.routeLineHoverWidthMin);
  const szRouteHoverWidthMax           = useColorStore(s => s.routeLineHoverWidthMax);
  const szHighlightedRadiusMin         = useColorStore(s => s.highlightedAirportRadiusMin);
  const szHighlightedRadiusMax         = useColorStore(s => s.highlightedAirportRadiusMax);
  const szHighlightedHoverRadiusMin    = useColorStore(s => s.highlightedAirportHoverRadiusMin);
  const szHighlightedHoverRadiusMax    = useColorStore(s => s.highlightedAirportHoverRadiusMax);
  const szGeneralRadiusMin             = useColorStore(s => s.generalAirportRadiusMin);
  const szGeneralRadiusMax             = useColorStore(s => s.generalAirportRadiusMax);
  const szGeneralHoverRadiusMin        = useColorStore(s => s.generalAirportHoverRadiusMin);
  const szGeneralHoverRadiusMax        = useColorStore(s => s.generalAirportHoverRadiusMax);
  const szTripRouteWidthMin            = useColorStore(s => s.tripRouteWidthMin);
  const szTripRouteWidthMax            = useColorStore(s => s.tripRouteWidthMax);
  const szTripRouteHoverWidthMin       = useColorStore(s => s.tripRouteHoverWidthMin);
  const szTripRouteHoverWidthMax       = useColorStore(s => s.tripRouteHoverWidthMax);
  const clrHighlightedCity             = useColorStore(s => s.highlightedCity);
  const clrGeneralCity                 = useColorStore(s => s.generalCity);
  const szHighlightedCityRadius        = useColorStore(s => s.highlightedCityRadius);
  const szGeneralCityRadius            = useColorStore(s => s.generalCityRadius);
  const szGeneralLabelSizeMin          = useColorStore(s => s.generalAirportLabelSizeMin);
  const szGeneralLabelSizeMax          = useColorStore(s => s.generalAirportLabelSizeMax);
  const szGeneralLabelHoverSizeMin     = useColorStore(s => s.generalLabelHoverSizeMin);
  const szGeneralLabelHoverSizeMax     = useColorStore(s => s.generalLabelHoverSizeMax);
  const szHighlightedLabelSizeMin      = useColorStore(s => s.highlightedLabelSizeMin);
  const szHighlightedLabelSizeMax      = useColorStore(s => s.highlightedLabelSizeMax);
  const szHighlightedLabelHoverSizeMin = useColorStore(s => s.highlightedLabelHoverSizeMin);
  const szHighlightedLabelHoverSizeMax = useColorStore(s => s.highlightedLabelHoverSizeMax);
  const zoomRangeMin                   = useColorStore(s => s.zoomRangeMin);
  const zoomRangeMax                   = useColorStore(s => s.zoomRangeMax);

  return {
    startPoints,
    clrGeneral,
    clrDestination,
    clrTripAirport,
    clrTripRoute,
    clrTransferRoute,
    clrTripHover,
    clrGeneralHover,
    clrDestinationHover,
    clrTransferRouteHover,
    clrGeneralLabelHover,
    clrGeneralLabel,
    clrDestinationLabel,
    clrDestinationLabelHover,
    clrTripLabel,
    clrTripLabelHover,
    szRouteWidthMin,
    szRouteWidthMax,
    szRouteHoverWidthMin,
    szRouteHoverWidthMax,
    szHighlightedRadiusMin,
    szHighlightedRadiusMax,
    szHighlightedHoverRadiusMin,
    szHighlightedHoverRadiusMax,
    szGeneralRadiusMin,
    szGeneralRadiusMax,
    szGeneralHoverRadiusMin,
    szGeneralHoverRadiusMax,
    szTripRouteWidthMin,
    szTripRouteWidthMax,
    szTripRouteHoverWidthMin,
    szTripRouteHoverWidthMax,
    clrHighlightedCity,
    clrGeneralCity,
    szHighlightedCityRadius,
    szGeneralCityRadius,
    szGeneralLabelSizeMin,
    szGeneralLabelSizeMax,
    szGeneralLabelHoverSizeMin,
    szGeneralLabelHoverSizeMax,
    szHighlightedLabelSizeMin,
    szHighlightedLabelSizeMax,
    szHighlightedLabelHoverSizeMin,
    szHighlightedLabelHoverSizeMax,
    zoomRangeMin,
    zoomRangeMax,
  };
}
