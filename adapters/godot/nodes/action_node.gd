class_name ActionBTNode
extends BTNode

var execute: Callable

func _on_tick(bb: Blackboard) -> Status:
	if execute.is_valid():
		return execute.call(bb)
	return Status.SUCCESS
