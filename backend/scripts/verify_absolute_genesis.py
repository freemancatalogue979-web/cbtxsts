"""Verify the level-100 crown and permanent Founder's 100 allocation."""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.game import MAX_LEVEL, award_absolute_genesis, tier_for_level
from app.models import Student


def main() -> None:
    assert MAX_LEVEL == 100
    assert tier_for_level(99) == "aurora_3"
    assert tier_for_level(100) == "absolute_genesis"

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        students = [
            Student(name=f"Scholar {i}", phone=f"100{i:03d}", username=f"scholar{i}")
            for i in range(1, 106)
        ]
        db.add_all(students)
        db.flush()
        for student in students:
            events: list[dict] = []
            award_absolute_genesis(db, student, events)
            db.flush()
            assert events[0]["type"] == "absolute_genesis"
            assert events[0]["level"] == 100

        numbers = [student.absolute_genesis_number for student in students]
        assert numbers[:100] == list(range(1, 101))
        assert numbers[100:] == [None] * 5
        assert all(student.absolute_genesis_at is not None for student in students)

        # Re-entering the reward path never consumes another Founder number.
        award_absolute_genesis(db, students[0], [])
        db.flush()
        assert students[0].absolute_genesis_number == 1
        assert students[99].absolute_genesis_number == 100

    print("Absolute Genesis OK — level 100, permanent honours, Founder numbers 001–100")


if __name__ == "__main__":
    main()
