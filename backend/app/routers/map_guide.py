from fastapi import APIRouter

from ..map_guide import payload

router = APIRouter(prefix="/map-guide", tags=["map-guide"])


@router.get("")
def get_map_guide():
    """Interactive Land of Dawn guide: clickable points of interest + role rotations."""
    return payload()
