class_name GuardNode
extends BTNode

var condition: Callable

func _on_tick(bb: Blackboard) -> Status:
	if children.is_empty():
		return Status.FAILURE
	if condition.is_valid() and not condition.call(bb):
		return Status.FAILURE
	return children[0].tick(bb)
