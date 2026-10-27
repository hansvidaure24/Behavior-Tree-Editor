class_name ConditionBTNode
extends BTNode

var check: Callable

func _on_tick(bb: Blackboard) -> Status:
	if check.is_valid() and check.call(bb):
		return Status.SUCCESS
	return Status.FAILURE
