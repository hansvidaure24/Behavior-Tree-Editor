class_name RepeatNode
extends BTNode

var _counter: int = 0

func _on_tick(bb: Blackboard) -> Status:
	if children.is_empty():
		return Status.FAILURE
	var count: int = int(parameters.get("count", 3))
	var status = children[0].tick(bb)
	if status == Status.RUNNING:
		return Status.RUNNING
	_counter += 1
	if _counter >= count:
		_counter = 0
		return status
	return Status.RUNNING
